/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import * as p from "./types/protocol";
import { RestateGrpcContextImpl } from "./restate_context_impl";
import { Connection, RestateStreamConsumer } from "./connection/connection";
import { ProtocolMode } from "./generated/proto/discovery";
import { Message } from "./types/types";
import { CompletablePromise } from "./utils/utils";
import { rlog } from "./utils/logger";
import { clearTimeout } from "timers";
import {
  COMPLETION_MESSAGE_TYPE,
  ERROR_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
} from "./types/protocol";
import { Journal } from "./journal";
import { Invocation } from "./invocation";
import {
  ensureError,
  TerminalError,
  RetryableError,
  errorToErrorMessage,
} from "./types/errors";
import { LocalStateStore } from "./local_state_store";

export class StateMachine<I, O> implements RestateStreamConsumer {
  private journal: Journal<I, O>;
  private restateContext: RestateGrpcContextImpl;

  private readonly invocationComplete = new CompletablePromise<void>();

  // when this flag is true, no more work will (and may) happen
  // this is set to true in case of
  //  - a completed invocation
  //  - a suspension
  //  - an error in the state machine
  private stateMachineClosed = false;

  public readonly localStateStore: LocalStateStore;

  // Whether the input channel (runtime -> service) is closed
  // If it is closed, then we suspend immediately upon the next suspension point
  // If it is open, then we suspend later because we might still get completions
  private inputChannelClosed = false;

  // Suspension timeout that gets set and cleared based on completion messages;
  private suspensionTimeout?: NodeJS.Timeout;

  private readonly suspensionMillis = 30_000;

  constructor(
    private readonly connection: Connection,
    private readonly invocation: Invocation<I, O>,
    private readonly protocolMode: ProtocolMode
  ) {
    this.localStateStore = invocation.localStateStore;

    this.restateContext = new RestateGrpcContextImpl(
      this.invocation.instanceKey,
      this.invocation.invocationId,
      this.invocation.method.service,
      this
    );
    this.journal = new Journal(this.invocation);
  }

  public handleMessage(m: Message): boolean {
    if (this.stateMachineClosed) {
      // ignore this message
      return false;
    }

    if (m.messageType !== COMPLETION_MESSAGE_TYPE) {
      throw RetryableError.protocolViolation(
        `Received message of type ${m.messageType}. Can only accept completion messages after replay has finished.`
      );
    }

    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Received completion message from Restate, adding to journal.",
      m.messageType,
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

    return false; // we are never complete
  }

  public handleUserCodeMessage<T>(
    messageType: bigint,
    message: p.ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): Promise<T | void> {
    // if the state machine is already closed, return a promise that never
    // completes, so that the user code does not resume
    if (this.stateMachineClosed) {
      return new CompletablePromise<T>().promise;
    }

    const promise = this.journal.handleUserSideMessage(messageType, message);

    // Only send the message to restate if we are not in replaying mode
    if (this.journal.isProcessing()) {
      rlog.debugJournalMessage(
        this.invocation.logPrefix,
        "Adding message to journal and sending to Restate",
        messageType,
        message
      );

      this.connection.send(
        new Message(
          messageType,
          message,
          completedFlag,
          protocolVersion,
          requiresAckFlag
        )
      );
    } else {
      rlog.debugJournalMessage(
        this.invocation.logPrefix,
        "Matched and replayed message from journal",
        messageType,
        message
      );
    }

    if (
      p.SUSPENSION_TRIGGERS.includes(messageType) &&
      this.journal.getCompletableIndices().length > 0
    ) {
      this.scheduleSuspension();
    }
    return promise;
  }

  /**
   * Invokes the RPC function and returns a promise that completes when the state machine
   * stops processing the invocation, meaning when:
   *   - The function completes with a result or an exception
   *   - The execution suspends
   *   - An error is raised in the state machine (network, API violation, ...)
   *
   * The returned promise resolves successfully for all the cases above, because the are (from
   * the perspective of the state machine) expected outcomes in which it send out corresponding
   * result messages and cleanly closed the connection.
   *
   * The returned promise is rejected when an unhandled error arises and the caller would be
   * expected to ensure that resources are properly cleaned up.
   */
  public invoke(): Promise<void> {
    // --------------------------------------------------------------------------------------------
    // Implementation note:
    //
    // This method is not async, because we don't want to actually await anything
    // in there. We cannot await the completion of the actual invocation, because for long-running
    // code (that suspends), the function invocation never completes. Instead, the state machine
    // triggers a suspension.
    // We need to do a bit of promise chaining for the rpc function promise, and return a different
    // promise that completes in also in suspension and error cases.
    // --------------------------------------------------------------------------------------------

    // it is unexpected for the state machine to be closed here, so we raise an error in
    // that case, unlike in other places, where we simply ignore things
    if (this.stateMachineClosed) {
      return Promise.reject(new Error("state machine is already closed"));
    }

    if (this.journal.nextEntryWillBeReplayed()) {
      rlog.debugInvokeMessage(
        this.invocation.logPrefix,
        "Resuming (replaying) function."
      );
    } else {
      rlog.debugInvokeMessage(this.invocation.logPrefix, "Invoking function.");
    }

    const resultBytes: Promise<Uint8Array> = this.invocation.method.invoke(
      this.restateContext,
      this.invocation.invocationValue
    );

    resultBytes
      .then((bytes) => {
        // invocation successfully returned with a result value
        try {
          // the state machine might be closed here in some cases like when there was an error (like
          // API violation) or a suspension, but the function code still completed
          if (this.stateMachineClosed) {
            rlog.warn(
              "Unexpected successful completion of the function after the state machine closed. " +
                "This may indicate that: \n" +
                "- the function code does not properly await some Restate calls " +
                "and did not notice an error \n" +
                "- the function code was delayed for longer than the suspension timeout \n" +
                "- the function code contained a try-catch block around a side effect which throws retryable errors. " +
                "This try-catch block should be placed inside the side effect."
            );
            return;
          }

          // handle the result value
          const msg = new Message(
            OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
            OutputStreamEntryMessage.create({
              value: Buffer.from(bytes),
            })
          );

          this.journal.handleUserSideMessage(msg.messageType, msg.message);

          if (!this.journal.outputMsgWasReplayed()) {
            this.connection.send(msg);

            rlog.debugJournalMessage(
              this.invocation.logPrefix,
              "Journaled and sent output message",
              msg.messageType,
              msg.message
            );
          } else {
            rlog.debugJournalMessage(
              this.invocation.logPrefix,
              "Replayed and matched output message from journal",
              msg.messageType,
              msg.message
            );
          }

          rlog.debugInvokeMessage(
            this.invocation.logPrefix,
            "Function completed successfully."
          );

          this.finish();
        } catch (e) {
          this.unhandledError(ensureError(e));
        }
      })
      .catch((e) => {
        // because of how we try/catch in the promise handler above, this here exclusively handles
        // errors coming from the rpc function
        try {
          // Sometimes the function code fails as a consequence of the state machine encountering
          // an error before (possibly Restate closed the connection).
          if (this.stateMachineClosed) {
            return;
          }

          const error = ensureError(e);
          rlog.debugInvokeMessage(
            this.invocation.logPrefix,
            "Function completed with an error: " + error.message
          );

          this.finishWithError(error);
        } catch (ee) {
          this.unhandledError(ensureError(ee));
        }
      });

    // this promise here completes under any completion, including the cases where the
    // rpc function does not end (error, suspension, ...)
    return this.invocationComplete.promise;
  }

  private async finishWithError(e: Error) {
    if (e instanceof TerminalError) {
      this.sendTerminalError(e);
    } else {
      this.sendRetryableError(e);
    }

    await this.finish();
  }

  private sendRetryableError(e: Error) {
    const msg = new Message(ERROR_MESSAGE_TYPE, errorToErrorMessage(e));
    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Invocation ended with retryable error.",
      msg.messageType,
      msg.message
    );

    this.connection.send(msg);
  }

  private sendTerminalError(e: TerminalError) {
    const msg = new Message(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: e.toFailure(),
      })
    );
    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Invocation ended with failure message.",
      msg.messageType,
      msg.message
    );

    this.journal.handleUserSideMessage(msg.messageType, msg.message);
    if (!this.journal.outputMsgWasReplayed()) {
      this.connection.send(msg);
    }
  }

  /**
   * Closes the state machine, flushes all output, and resolves the invocation promise.
   */
  private async finish() {
    try {
      this.stateMachineClosed = true;
      this.journal.close();
      this.clearSuspensionTimeout();

      await this.connection.end();

      this.invocationComplete.resolve();
    } catch (e) {
      this.invocationComplete.reject(ensureError(e));
    }
  }

  /**
   * This function propagates errors up to the completion promise, to be handled
   * on the connection layer.
   */
  private unhandledError(e: Error) {
    this.invocationComplete.reject(e);
    this.stateMachineClosed = true;
    this.journal.close();
    this.clearSuspensionTimeout();
  }

  private scheduleSuspension() {
    // If there was already a timeout set, we want to reset the time to postpone suspension as long as we make progress.
    // So we first clear the old timeout, and then we set a new one.
    if (this.suspensionTimeout !== undefined) {
      clearTimeout(this.suspensionTimeout);
      this.suspensionTimeout = undefined;
    }

    const delay = this.getSuspensionMillis();
    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Scheduling suspension in " + delay + " ms"
    );

    // Set a new suspension with a new timeout
    // The suspension will only be sent if the timeout is not canceled due to a completion.
    this.suspensionTimeout = setTimeout(() => {
      this.suspend();
    }, delay);
  }

  // Suspension timeouts:
  // Lambda case: suspend immediately when control is back in the user code
  // Bidi streaming case:
  // - suspend after 1 seconds if input channel is still open (can still get completions)
  // - suspend immediately if input channel is closed (cannot get completions)
  private getSuspensionMillis(): number {
    return this.protocolMode === ProtocolMode.REQUEST_RESPONSE ||
      this.inputChannelClosed
      ? 0
      : this.suspensionMillis;
  }

  private async suspend() {
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
    const msg = new Message(
      SUSPENSION_MESSAGE_TYPE,
      SuspensionMessage.create({
        entryIndexes: indices,
      })
    );

    rlog.debugJournalMessage(
      this.invocation.logPrefix,
      "Writing suspension message to journal.",
      msg.messageType,
      msg.message
    );

    this.journal.handleUserSideMessage(msg.messageType, msg.message);
    if (!this.journal.outputMsgWasReplayed()) {
      this.connection.send(msg);
    }

    rlog.debugInvokeMessage(this.invocation.logPrefix, "Suspending function.");

    await this.finish();
  }

  public async notifyHandlerExecutionError(e: RetryableError | TerminalError) {
    await this.finishWithError(e);
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

  public handleInputClosed(): void {
    if (
      this.journal.isClosed() ||
      this.stateMachineClosed ||
      this.inputChannelClosed
    ) {
      return;
    }

    this.inputChannelClosed = true;

    rlog.debug(
      this.invocation.logPrefix +
        " : Restate closed connection to trigger suspension."
    );

    // If there is a timeout planned, reset the timout to execute immediately when the work is done.
    if (this.suspensionTimeout !== undefined) {
      this.scheduleSuspension();
    }
  }

  public handleStreamError(e: Error): void {
    rlog.info(
      "Aborting function execution and closing state machine due to connection error: " +
        e.message
    );

    this.unhandledError(e);
  }

  public nextEntryWillBeReplayed() {
    return this.journal.nextEntryWillBeReplayed();
  }

  private clearSuspensionTimeout() {
    if (this.suspensionTimeout !== undefined) {
      clearTimeout(this.suspensionTimeout);
      this.suspensionTimeout = undefined;
    }
  }
}
