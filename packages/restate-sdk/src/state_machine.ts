/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import * as p from "./types/protocol";
import { ContextImpl } from "./context_impl";
import { Connection, RestateStreamConsumer } from "./connection/connection";
import { Message } from "./types/types";
import {
  createStateMachineConsole,
  StateMachineConsole,
} from "./utils/message_logger";
import {
  COMBINATOR_ENTRY_MESSAGE,
  COMPLETION_MESSAGE_TYPE,
  END_MESSAGE_TYPE,
  EndMessage,
  ENTRY_ACK_MESSAGE_TYPE,
  ERROR_MESSAGE_TYPE,
  OUTPUT_ENTRY_MESSAGE_TYPE,
  OutputEntryMessage,
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
  JournalErrorContext,
} from "./types/errors";
import { LocalStateStore } from "./local_state_store";
import { createRestateConsole, LoggerContext } from "./logger";
import {
  CompletablePromise,
  wrapDeeply,
  WRAPPED_PROMISE_PENDING,
  WrappedPromise,
} from "./utils/promises";
import {
  PromiseCombinatorTracker,
  PromiseId,
  PromiseType,
} from "./promise_combinator_tracker";
import { CombinatorEntryMessage } from "./generated/proto/javascript_pb";
import { ProtocolMode } from "./types/discovery";

export class StateMachine implements RestateStreamConsumer {
  private journal: Journal;
  private restateContext: ContextImpl;

  private readonly invocationComplete = new CompletablePromise<Buffer | void>();

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

  private promiseCombinatorTracker: PromiseCombinatorTracker;

  console: StateMachineConsole;

  constructor(
    private readonly connection: Connection,
    private readonly invocation: Invocation,
    private readonly protocolMode: ProtocolMode,
    keyedContext: boolean,
    loggerContext: LoggerContext,
    private readonly suspensionMillis: number = 30_000
  ) {
    this.localStateStore = invocation.localStateStore;
    this.console = createStateMachineConsole(loggerContext);

    this.restateContext = new ContextImpl(
      this.invocation.id,
      // The console exposed by RestateContext filters logs in replay, while the internal one is based on the ENV variables.
      createRestateConsole(loggerContext, () => !this.journal.isReplaying()),
      keyedContext,
      invocation.userKey,
      invocation.invocationValue,
      invocation.invocationHeaders,
      this
    );
    this.journal = new Journal(this.invocation);
    this.promiseCombinatorTracker = new PromiseCombinatorTracker(
      this.readCombinatorOrderEntry.bind(this),
      this.writeCombinatorOrderEntry.bind(this)
    );
  }

  public handleMessage(m: Message): boolean {
    if (this.stateMachineClosed) {
      // ignore this message
      return false;
    }

    if (m.messageType === COMPLETION_MESSAGE_TYPE) {
      this.console.debugJournalMessage(
        "Received completion message from Restate, adding to journal.",
        m.messageType,
        m.message
      );
      this.journal.handleRuntimeCompletionMessage(
        m.message as p.CompletionMessage
      );
    } else if (m.messageType === ENTRY_ACK_MESSAGE_TYPE) {
      this.console.debugJournalMessage(
        "Received entry ack message from Restate, adding to journal.",
        m.messageType,
        m.message
      );
      this.journal.handleEntryAckMessage(m.message as p.EntryAckMessage);
    } else {
      throw RetryableError.protocolViolation(
        `Received message of type ${m.messageType}. Can only accept completion or acks messages after replay has finished.`
      );
    }

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
    message: p.ProtocolMessage,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): WrappedPromise<T | void> {
    // if the state machine is already closed, return a promise that never
    // completes, so that the user code does not resume
    if (this.stateMachineClosed) {
      return WRAPPED_PROMISE_PENDING as WrappedPromise<T | void>;
    }

    const promise = this.journal.handleUserSideMessage(messageType, message);
    const journalIndex = this.journal.getUserCodeJournalIndex();

    // Only send the message to restate if we are not in replaying mode
    if (this.journal.isProcessing()) {
      this.console.debugJournalMessage(
        "Adding message to journal and sending to Restate",
        messageType,
        message
      );

      this.send(
        new Message(
          messageType,
          message,
          completedFlag,
          protocolVersion,
          requiresAckFlag
        )
      );
    } else {
      this.console.debugJournalMessage(
        "Matched and replayed message from journal",
        messageType,
        message
      );
    }

    return wrapDeeply(promise, () => {
      if (!p.SUSPENSION_TRIGGERS.includes(messageType)) {
        return;
      }
      if (this.journal.isUnResolved(journalIndex)) {
        this.hitSuspensionPoint();
      }
    });
  }

  // -- Methods related to combinators to wire up promise combinator API with PromiseCombinatorTracker

  public createCombinator(
    combinatorConstructor: (
      promises: PromiseLike<unknown>[]
    ) => Promise<unknown>,
    promises: Array<{ id: PromiseId; promise: Promise<unknown> }>
  ) {
    if (this.stateMachineClosed) {
      return WRAPPED_PROMISE_PENDING as WrappedPromise<unknown>;
    }

    // We don't need the promise wrapping here to schedule a suspension,
    // because the combined promises will already have that, so once we call then() on them,
    // if we have to suspend we will suspend.
    return this.promiseCombinatorTracker.createCombinator(
      combinatorConstructor,
      promises
    );
  }

  readCombinatorOrderEntry(combinatorId: number): PromiseId[] | undefined {
    const wannabeCombinatorEntry = this.journal.readNextReplayEntry();
    if (wannabeCombinatorEntry === undefined) {
      // We're in processing mode
      return undefined;
    }
    if (wannabeCombinatorEntry.messageType !== COMBINATOR_ENTRY_MESSAGE) {
      throw RetryableError.journalMismatch(
        this.journal.getUserCodeJournalIndex(),
        wannabeCombinatorEntry,
        {
          messageType: COMBINATOR_ENTRY_MESSAGE,
          message: {
            combinatorId,
          } as CombinatorEntryMessage,
        }
      );
    }

    const combinatorMessage =
      wannabeCombinatorEntry.message as CombinatorEntryMessage;
    if (combinatorMessage.combinatorId != combinatorId) {
      throw RetryableError.journalMismatch(
        this.journal.getUserCodeJournalIndex(),
        wannabeCombinatorEntry,
        {
          messageType: COMBINATOR_ENTRY_MESSAGE,
          message: {
            combinatorId,
          } as CombinatorEntryMessage,
        }
      );
    }

    this.console.debugJournalMessage(
      "Matched and replayed message from journal",
      COMBINATOR_ENTRY_MESSAGE,
      combinatorMessage
    );

    return combinatorMessage.journalEntriesOrder.map((id) => ({
      id,
      type: PromiseType.JournalEntry,
    }));
  }

  async writeCombinatorOrderEntry(combinatorId: number, order: PromiseId[]) {
    if (this.journal.isProcessing()) {
      const combinatorMessage: CombinatorEntryMessage =
        new CombinatorEntryMessage({
          combinatorId,
          journalEntriesOrder: order.map((pid) => pid.id),
        });
      this.console.debugJournalMessage(
        "Adding message to journal and sending to Restate",
        COMBINATOR_ENTRY_MESSAGE,
        combinatorMessage
      );

      const ackPromise = this.journal.appendJournalEntry(
        COMBINATOR_ENTRY_MESSAGE,
        combinatorMessage
      );
      this.send(
        new Message(
          COMBINATOR_ENTRY_MESSAGE,
          combinatorMessage,
          undefined,
          undefined,
          true
        )
      );

      this.hitSuspensionPoint();
      await ackPromise;
    }
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
  public invoke(): Promise<Buffer | void> {
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
      this.console.debugInvokeMessage("Resuming (replaying) function.");
    } else {
      this.console.debugInvokeMessage("Invoking function.");
    }

    this.invocation.handler
      .invoke(this.restateContext, this.invocation.invocationValue)
      .then((bytes) => {
        // invocation successfully returned with a result value
        try {
          // the state machine might be closed here in some cases like when there was an error (like
          // API violation) or a suspension, but the function code still completed
          if (this.stateMachineClosed) {
            this.console.warn(
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

          const value = Buffer.from(bytes);

          // handle the result value
          const msg = new Message(
            OUTPUT_ENTRY_MESSAGE_TYPE,
            new OutputEntryMessage({
              result: { case: "value", value },
            })
          );

          this.journal.handleUserSideMessage(msg.messageType, msg.message);

          if (!this.journal.outputMsgWasReplayed()) {
            this.send(msg);

            this.console.debugJournalMessage(
              "Journaled and sent output message",
              msg.messageType,
              msg.message
            );
          } else {
            this.console.debugJournalMessage(
              "Replayed and matched output message from journal",
              msg.messageType,
              msg.message
            );
          }

          this.console.debugInvokeMessage("Function completed successfully.");

          // Mark the end of the invocation
          this.send(new Message(END_MESSAGE_TYPE, new EndMessage()));

          this.finish(value);
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
          this.console.trace(
            "Function completed with an error: " + error.message,
            e
          );

          this.sendErrorAndFinish(error);
        } catch (ee) {
          this.unhandledError(ensureError(ee));
        }
      });

    // this promise here completes under any completion, including the cases where the
    // rpc function does not end (error, suspension, ...)
    return this.invocationComplete.promise;
  }

  public async sendErrorAndFinish(e: Error, ctx?: JournalErrorContext) {
    if (e instanceof TerminalError) {
      this.sendTerminalError(e);
    } else {
      this.sendRetryableError(e, ctx);
    }

    await this.finish();
  }

  private sendRetryableError(e: Error, ctx?: JournalErrorContext) {
    const msg = new Message(ERROR_MESSAGE_TYPE, errorToErrorMessage(e, ctx));
    this.console.debugJournalMessage(
      "Invocation ended with retryable error.",
      msg.messageType,
      msg.message
    );

    this.send(msg);
  }

  private sendTerminalError(e: TerminalError) {
    const msg = new Message(
      OUTPUT_ENTRY_MESSAGE_TYPE,
      new OutputEntryMessage({
        result: { case: "failure", value: e.toFailure() },
      })
    );
    this.console.debugJournalMessage(
      "Invocation ended with failure message.",
      msg.messageType,
      msg.message
    );

    this.journal.handleUserSideMessage(msg.messageType, msg.message);
    if (!this.journal.outputMsgWasReplayed()) {
      this.send(msg);
    }

    // Mark the end of the invocation
    this.send(new Message(END_MESSAGE_TYPE, new EndMessage()));
  }

  private send(message: Message) {
    this.connection.send(message).catch((err) => {
      this.handleStreamError(err);
    });
  }

  /**
   * Closes the state machine, flushes all output, and resolves the invocation promise.
   */
  private async finish(value?: Buffer) {
    try {
      this.stateMachineClosed = true;
      this.journal.close();
      this.clearSuspensionTimeout();

      await this.connection.end();

      this.invocationComplete.resolve(value);
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

  /**
   * This method is invoked when we hit a suspension point. A suspension point is everytime the user "await"s a Promise returned by RestateContext that might be completed at a later point in time by a CompletionMessage/AckMessage.
   *
   * Depending on the state of the read channel, and on the protocol mode, it might either immediately suspend, or schedule a suspension to happen at a later point in time.
   */
  private hitSuspensionPoint() {
    // If there was already a timeout set, we want to reset the time to postpone suspension as long as we make progress.
    // So we first clear the old timeout, and then we set a new one.
    this.clearSuspensionTimeout();

    const delay = this.getSuspensionMillis();
    this.console.debugJournalMessage(
      "Scheduling suspension in " + delay + " ms"
    );

    if (delay >= 0) {
      // Set a new suspension with a new timeout
      // The suspension will only be sent if the timeout is not canceled due to a completion.
      // In case the delay is 0 we still schedule a timeout in order to process the suspension on the next process tick,
      // without interrupting the current work.
      this.suspensionTimeout = setTimeout(() => {
        this.suspend();
      }, delay);
    }
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
      new SuspensionMessage({
        entryIndexes: indices,
      })
    );

    this.console.debugJournalMessage(
      "Writing suspension message to journal.",
      msg.messageType,
      msg.message
    );

    this.journal.handleUserSideMessage(msg.messageType, msg.message);
    if (!this.journal.outputMsgWasReplayed()) {
      this.send(msg);
    }

    this.console.debugInvokeMessage("Suspending function.");

    await this.finish();
  }

  /**
   * WARNING: make sure you use this at the right point in the code
   * After the index has been incremented...
   * This is error-prone... Would be good to have a better solution for this.
   */
  public getUserCodeJournalIndex(): number {
    return this.journal.getUserCodeJournalIndex();
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

    this.console.debug("Restate closed connection to trigger suspension.");

    // If there is a timeout planned, reset the timout to execute immediately when the work is done.
    if (this.suspensionTimeout !== undefined) {
      this.hitSuspensionPoint();
    }
  }

  public handleStreamError(e: Error): void {
    this.console.info(
      "Aborting function execution and closing state machine due to connection error: " +
        e.message
    );

    this.unhandledError(e);
  }

  public handleDanglingPromiseError(e: Error): void {
    this.console.info(
      "Aborting function execution and closing state machine due to an error: " +
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
