"use strict";

import * as p from "./types/protocol";
import { RestateContextImpl } from "./restate_context_impl";
import { Connection } from "./connection/connection";
import { ProtocolMode } from "./generated/proto/discovery";
import { Message } from "./types/types";
import { printMessageAsJson } from "./utils/utils";
import { rlog } from "./utils/logger";
import { clearTimeout } from "timers";
import {
  COMPLETION_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
} from "./types/protocol";
import { Failure } from "./generated/proto/protocol";
import { Journal } from "./journal";
import { Invocation } from "./invocation";
import {LocalStateStore} from "./local_state_store";

export class StateMachine<I, O> {
  private journal: Journal<I, O>;
  private restateContext: RestateContextImpl<I, O>;

  public readonly localStateStore: LocalStateStore

  // Whether the input channel (runtime -> service) is closed
  // If it is closed, then we suspend immediately upon the next suspension point
  // If it is open, then we suspend later because we might still get completions
  private inputChannelClosed = false;

  // Suspension timeout that gets set and cleared based on completion messages;
  private suspensionTimeout?: NodeJS.Timeout;

  constructor(
    private readonly connection: Connection,
    private readonly invocation: Invocation<I, O>,
  ) {
    this.localStateStore = invocation.localStateStore;

    this.restateContext = new RestateContextImpl(
      this.invocation.instanceKey,
      this.invocation.invocationId,
      this.invocation.method.service,
      this
    );
    this.journal = new Journal(this.invocation);

    connection.onClose(this.setInputChannelToClosed.bind(this));
    connection.onError(this.handleError.bind(this));
  }

  public handleRuntimeMessage(m: Message) {
    if (m.messageType !== COMPLETION_MESSAGE_TYPE) {
      throw new Error(
        `Received message of type ${m.messageType}. Can only accept completion messages after replay has finished.`
      );
    }

    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Handling runtime completion message: ",
      m.message
    );
    this.journal.handleRuntimeCompletionMessage(
      m.message as p.CompletionMessage
    );
    // Remove lingering suspension timeouts, if we are not waiting for completions anymore
    if (
      this.suspensionTimeout !== undefined &&
      this.journal.getCompletableIndices().length === 0
    ) {
      clearTimeout(this.suspensionTimeout);
      this.suspensionTimeout = undefined;
    }
  }

  public handleUserCodeMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): Promise<T | void> {
    /*
    Can take any type of message as input (also input stream and output stream)
    */
    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Adding message to output buffer: type: ",
      message
    );

    const promise = this.journal.handleUserSideMessage(messageType, message);

    // Only send if we are in processing mode. Not if we are replaying user code
    if (this.journal.isProcessing()) {
      this.connection.buffer(
        new Message(
          messageType,
          message,
          completedFlag,
          protocolVersion,
          requiresAckFlag
        )
      );
    }

    if (
      p.SUSPENSION_TRIGGERS.includes(messageType) &&
      this.journal.getCompletableIndices().length > 0
    ) {
      this.connection.flush();
      this.scheduleSuspension();
    }
    return promise;
  }

  invoke() {
    this.invocation.method
      .invoke(
        this.restateContext,
        this.invocation.invocationValue,
        this.invocation.logPrefix
      )
      .then((result) => {
        rlog.debugJournalMessage(
          this.invocation.logPrefix,
          "Call ended successful with message.",
          result.message
        );
        this.journal.handleUserSideMessage(result.messageType, result.message);

        if (!this.journal.outputMsgWasReplayed()) {
          this.connection.buffer(result);
        }
      })
      .catch(async (e) => {
        if (e instanceof Error) {
          rlog.warn(
            `${this.invocation.logPrefix} Call failed: ${e.message} - ${e.stack}`
          );
        } else {
          rlog.warn(
            `${this.invocation.logPrefix} Call failed: ${printMessageAsJson(e)}`
          );
        }
        const message = new Message(
          OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
          OutputStreamEntryMessage.create({
            failure: Failure.create({
              code: 13,
              message: `${this.invocation.logPrefix} Uncaught exception for invocation id: ${e.message}`,
            }),
          })
        );
        if (!this.journal.outputMsgWasReplayed()) {
          this.connection.buffer(message);
        }
      })
      .finally(async () => {
        try {
          await this.connection.flush();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          rlog.warn(
            `${this.invocation.logPrefix} Failed to flush output/suspension message to the runtime: ${e.message} - ${e.stack}`
          );
        } finally {
          // even if we failed to flush, we need to close out this state machine
          this.connection.end();
        }
      });
  }

  scheduleSuspension() {
    // If there was already a timeout set, we want to reset the time to postpone suspension as long as we make progress.
    // So we first clear the old timeout, and then we set a new one.
    if (this.suspensionTimeout !== undefined) {
      clearTimeout(this.suspensionTimeout);
      this.suspensionTimeout = undefined;
    }

    rlog.debug(`Scheduling suspension for ${this.getSuspensionMillis()} ms`);
    // Set a new suspension with a new timeout
    // The suspension will only be sent if the timeout is not canceled due to a completion.
    this.suspensionTimeout = setTimeout(() => {
      this.suspend();
    }, this.getSuspensionMillis());
  }

  // Suspension timeouts:
  // Lambda case: suspend immediately when control is back in the user code
  // Bidi streaming case:
  // - suspend after 1 seconds if input channel is still open (can still get completions)
  // - suspend immediately if input channel is closed (cannot get completions)
  getSuspensionMillis(): number {
    return this.invocation.protocolMode === ProtocolMode.REQUEST_RESPONSE
      ? 0
      : this.inputChannelClosed
      ? 0
      : 1000;
  }

  suspend() {
    rlog.debug("Suspending");

    const indices = this.journal.getCompletableIndices();
    // If the state is closed then we either already send a suspension
    // or something else bad happened...
    if (this.journal.isClosed() || indices.length === 0) {
      return;
    }

    // There need to be journal entries to complete, otherwise this timeout should have been removed.
    // A suspension message is the end of the invocation.
    // Resolve the root call with the suspension message
    // This will lead to a onCallSuccess call where this msg will be sent.
    const msg = SuspensionMessage.create({
      entryIndexes: indices,
    });
    this.invocation.method.resolve(new Message(SUSPENSION_MESSAGE_TYPE, msg));
  }

  public async notifyApiViolation(code: number, msg: string) {
    await this.handleUserCodeMessage(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: Failure.create({
          code: 13,
          message: msg,
        }),
      })
    );
  }

  /**
   * WARNING: make sure you use this at the right point in the code
   * After the index has been incremented...
   * This is error-prone... Would be good to have a better solution for this.
   */
  public getUserCodeJournalIndex(): number {
    return this.journal.getUserCodeJournalIndex();
  }

  public getFullServiceName(): string {
    return `${this.invocation.method.packge}.${this.invocation.method.service}`;
  }

  setInputChannelToClosed() {
    if (this.journal.isClosed()) {
      return;
    }

    this.inputChannelClosed = true;
    // If there is a timeout planned, reset the timout to execute immediately when the work is done.
    if (this.suspensionTimeout !== undefined) {
      this.scheduleSuspension();
    }
  }

  handleError(e: Error) {
    this.journal.close();
    return;
  }

  nextEntryWillBeReplayed() {
    return this.journal.nextEntryWillBeReplayed();
  }
}
