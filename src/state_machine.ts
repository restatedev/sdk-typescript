"use strict";

import { Connection } from "./connection/connection";
import { HostedGrpcServiceMethod } from "./types/grpc";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  AwakeableIdentifier,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  BackgroundInvokeEntryMessage,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  ClearStateEntryMessage,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  CompleteAwakeableEntryMessage,
  COMPLETION_MESSAGE_TYPE,
  CompletionMessage,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GetStateEntryMessage,
  INVOKE_ENTRY_MESSAGE_TYPE,
  InvokeEntryMessage,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OutputStreamEntryMessage,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  PollInputStreamEntryMessage,
  ProtocolMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  SleepEntryMessage,
  START_MESSAGE_TYPE,
  StartMessage,
  SUSPENSION_MESSAGE_TYPE,
  SUSPENSION_TRIGGERS,
  SuspensionMessage,
} from "./types/protocol";
import { RestateContext } from "./restate_context";
import {
  clearStateMsgEquality,
  completeAwakeableMsgEquality,
  getStateMsgEquality,
  invokeMsgEquality,
  printMessageAsJson,
  setStateMsgEquality,
  uuidV7FromBuffer,
} from "./utils/utils";
import { Failure } from "./generated/proto/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { Empty } from "./generated/google/protobuf/empty";
import { ProtocolMode } from "./generated/proto/discovery";
import { clearTimeout } from "timers";
import { Message } from "./types/types";
import { rlog } from "./utils/logger";

enum ExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}

/**
 * We use this for two purposes:
 * 1. To route completions of the runtime back to their original promise.
 * For example, get state and side effects.
 * 2. To do journal mismatch checks during replays.
 * Journal mismatch checks:
 * - During replay: message type and message content have to be the same as in the replayed journal entries.
 * Side effects during replay: only the message type is checked. To avoid having to re-execute the side effect code during replay
 * - During normal execution:
 * no journal mismatch checks --> You don't have any info in the completion message to do that.
 *
 * message: filled in for everything except side effects because we don't want to redo the side effect during replay.
 * resolve: filled in if this message requires a completion
 * reject: filled in if this message requires a completion
 */
export class PendingMessage {
  constructor(
    readonly messageType: bigint,
    readonly message?: ProtocolMessage | Uint8Array,
    readonly resolve?: (value: unknown) => void,
    readonly reject?: (reason: Failure | Error) => void
  ) {}
}

/**
 * During replay: if replay message from the runtime are processed faster than that the user code progresses,
 * then we store the out-of-order replay messages in a map (see below).
 * The CompletionResult is the data of those out-of-order messages that we store in the map.
 */
type CompletionResult = {
  journalIndex: number;
  messageType: bigint;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  message: any;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  comparisonFct: (msg1: any, msg2: any) => boolean;
  value?: any;
  failure?: Failure;
};

export class DurableExecutionStateMachine<I, O> implements RestateContext {
  private state: ExecutionState = ExecutionState.WAITING_FOR_START;

  // Obtained after StartMessage
  // You need access to these three fields within your service, so you can deliver them to external systems to completer awakeables
  public instanceKey!: Buffer;
  public serviceName: string;
  public invocationId!: Buffer;
  // Parsed string representation of the invocationId
  public invocationIdString!: string;
  // We set the log prefix to [service-name] [method-name] [invocation-id] upon receiving the start message
  private logPrefix = "";
  // Number of journal entries that will be replayed by the runtime
  private nbEntriesToReplay!: number;
  // Increments for each replay message we get from the runtime.
  // We need this to match incoming replayed messages with the promises they need to resolve (can be out of sync).
  private replayIndex = 0;

  // Current journal index from user code perspective (as opposed to replay perspective)
  private currentJournalIndex = 0;

  // This flag is set to true when an inter-service request is done that needs to happen in the background.
  // Both types of requests (background or sync) call the same request() method.
  // So to be able to know if a request is a background request or not, the user first sets this flag:
  // e.g.: ctx.inBackground(() => client.greet(request))
  private inBackgroundCallFlag = false;

  // This flag is set to true when we are executing code that is inside a side effect.
  // We use this flag to prevent the user from doing operations on the context from within a side effect.
  // e.g. ctx.sideEffect(() => {await ctx.get("my-state")})
  private inSideEffectFlag = false;

  // Promises that need to be resolved.
  // Journal index -> PendingMessage(messageType, message?, resolve?, reject?)
  // This map contains:
  // - During replay: all the journal entries, to be able to check for journal mismatches.
  // - During normal execution: only the journal entries that require an ack/completion from the runtime.
  private indexToPendingMsgMap: Map<number, PendingMessage> = new Map();
  // Replay messages that arrived before the user code was at that point.
  // When the runtime message are replayed faster than the user code progresses.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private outOfOrderReplayMessages: Map<number, CompletionResult> = new Map();

  private suspensionTriggers!: bigint[];
  private readonly suspensionMillis;

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>,
    private readonly protocolMode: ProtocolMode
  ) {
    connection.onMessage(this.onIncomingMessage.bind(this));
    connection.onClose(this.onClose.bind(this));
    this.serviceName = method.service;

    if (SUSPENSION_TRIGGERS.has(protocolMode)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.suspensionTriggers = SUSPENSION_TRIGGERS.get(protocolMode)!;
    } else {
      // cannot use method.reject here because it is not defined yet!
      // This will also not get picked up in onCallFailure because it happens earlier.
      // So we need to close the state machine and the connection and throw an error.
      this.onClose();
      this.connection.end();
      throw new Error(
        "Unknown protocol mode. Protocol mode does not have suspension triggers defined."
      );
    }
    this.suspensionMillis =
      this.protocolMode === ProtocolMode.REQUEST_RESPONSE ? 0 : 100;

    connection.addOnErrorListener(() => {
      this.onClose();
    });
  }

  async get<T>(name: string): Promise<T | null> {
    if (!this.isValidState("get state")) {
      return Promise.reject();
    }

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();

      const msg = GetStateEntryMessage.create({ key: Buffer.from(name) });
      this.storePendingMsg(
        this.currentJournalIndex,
        GET_STATE_ENTRY_MESSAGE_TYPE,
        msg,
        resolve,
        reject
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: GetState message will not be forwarded to the runtime. Expecting completion.
        return;
      }

      rlog.debug(
        `${
          this.logPrefix
        } Adding message to output buffer: type: GetState, message: ${printMessageAsJson(
          msg
        )}`
      );
      this.send(GET_STATE_ENTRY_MESSAGE_TYPE, msg);
    }).then((result: Buffer | null) => {
      if (result == null || JSON.stringify(result) === "{}") {
        return null;
      } else {
        return JSON.parse(result.toString()) as T;
      }
    });
  }

  set<T>(name: string, value: T): void {
    if (!this.isValidState("set state")) {
      return;
    }
    this.incrementJournalIndex();

    const bytes = Buffer.from(JSON.stringify(value));
    const msg = SetStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
      value: bytes,
    });

    if (this.state === ExecutionState.REPLAYING) {
      // In replay mode: SetState message will not be forwarded to the runtime. Expecting completion.
      // Adding to pending messages to do journal mismatch checks during replay.
      // During normal execution (non-replay),
      // we don't expect a completion from the runtime, so we don't add this message to the pending messages.
      // There is no completion during replay either, so we don't add resolve and reject.
      this.storePendingMsg(
        this.currentJournalIndex,
        SET_STATE_ENTRY_MESSAGE_TYPE,
        msg
      );
      return;
    }

    rlog.debug(
      `${
        this.logPrefix
      } Adding message to output buffer: type: SetState, message: ${printMessageAsJson(
        msg
      )}`
    );
    this.send(SET_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  clear(name: string): void {
    if (!this.isValidState("clear state")) {
      return;
    }
    this.incrementJournalIndex();

    const msg = ClearStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
    });

    if (this.state === ExecutionState.REPLAYING) {
      //In replay mode: ClearState message will not be forwarded to the runtime. Expecting completion.
      // Adding to pending messages to do journal mismatch checks during replay.
      // During normal execution (non-replay),
      // we don't expect a completion from the runtime, so we don't add this message to the pending messages.
      // There is no completion during replay either, so we don't add resolve and reject.
      this.storePendingMsg(
        this.currentJournalIndex,
        CLEAR_STATE_ENTRY_MESSAGE_TYPE,
        msg
      );
      return;
    }

    rlog.debug(
      `${
        this.logPrefix
      } Adding message to output buffer: type: ClearState, message: ${printMessageAsJson(
        msg
      )}`
    );
    this.send(CLEAR_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  awakeable<T>(): { id: string; promise: Promise<T> } {
    if (!this.isValidState("awakeable")) {
      // We need to throw here because we cannot return void or Promise.reject...
      // This will have the same end result because it gets caught by onCallFailure
      throw new Error();
    }

    let suspensionTimeout: NodeJS.Timeout;

    let awakeableIdentifier;

    const awakeablePromise = new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();

      // This couldn't be done earlier because the index was not incremented yet.
      awakeableIdentifier = new AwakeableIdentifier(
        this.serviceName,
        this.instanceKey,
        this.invocationId,
        this.currentJournalIndex
      );

      const msg = AwakeableEntryMessage.create();
      this.storePendingMsg(
        this.currentJournalIndex,
        AWAKEABLE_ENTRY_MESSAGE_TYPE,
        msg,
        resolve,
        reject
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: awakeable message will not be forwarded to the runtime. Expecting completion.
        return;
      }

      rlog.debug(
        `${
          this.logPrefix
        } Adding message to output buffer: type: Awakeable, message: ${printMessageAsJson(
          msg
        )}`
      );
      const timeout = this.send(AWAKEABLE_ENTRY_MESSAGE_TYPE, msg);

      // an awakeable should trigger a suspension
      if (timeout) {
        suspensionTimeout = timeout;
      } else {
        throw new Error(
          "Illegal state: An awakeable should always set a suspension timeout"
        );
      }
    })
      .then<T>((result: Buffer) => {
        return JSON.parse(result.toString()) as T;
      })
      .finally(() => {
        // If the promise gets completed before the suspension gets triggered, then clear the timeout
        if (suspensionTimeout) {
          clearTimeout(suspensionTimeout);
        }
      });

    return {
      id: JSON.stringify(awakeableIdentifier),
      promise: awakeablePromise,
    };
  }

  completeAwakeable<T>(id: string, payload: T): void {
    if (!this.isValidState("completeAwakeable")) {
      return;
    }
    this.incrementJournalIndex();

    // Parse the string to an awakeable identifier
    const awakeableIdentifier = JSON.parse(id, (key, value) => {
      if (value && value.type === "Buffer") {
        return Buffer.from(value.data);
      }
      return value;
    }) as AwakeableIdentifier;

    const msg = CompleteAwakeableEntryMessage.create({
      serviceName: awakeableIdentifier.serviceName,
      instanceKey: awakeableIdentifier.instanceKey,
      invocationId: awakeableIdentifier.invocationId,
      entryIndex: awakeableIdentifier.entryIndex,
      payload: Buffer.from(JSON.stringify(payload)),
    });

    if (this.state === ExecutionState.REPLAYING) {
      //In replay mode: CompleteAwakeable message will not be forwarded to the runtime. Expecting completion.
      // Adding to pending messages to do journal mismatch checks during replay.
      // During normal execution (non-replay),
      // we don't expect a completion from the runtime, so we don't add this message to the pending messages.
      // There is no completion during replay either, so we don't add resolve and reject.
      this.storePendingMsg(
        this.currentJournalIndex,
        COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
        msg
      );
      return;
    }
    rlog.debug(
      `${
        this.logPrefix
      } Adding message to output buffer: type: CompleteAwakeable, message: ${printMessageAsJson(
        msg
      )}`
    );
    this.send(COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, msg);
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (this.inBackgroundCallFlag) {
      return this.invokeInBackground(service, method, data);
    } else {
      return this.invoke(service, method, data);
    }
  }

  async invokeInBackground(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    // Validation check that we are not in a sideEffect is done in inBackground() already.
    this.incrementJournalIndex();

    const msg = BackgroundInvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
    });

    if (this.state === ExecutionState.REPLAYING) {
      // In replay mode: background invoke will not be forwarded to the runtime.
      // Expecting completion.
      // Adding to pending messages to do journal mismatch checks during replay.
      // During normal execution (non-replay),
      // we don't expect a completion from the runtime, so we don't add this message to the pending messages.
      // There is no completion during replay either, so we don't add resolve and reject.
      this.storePendingMsg(
        this.currentJournalIndex,
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        msg
      );
    } else {
      rlog.debug(
        `${
          this.logPrefix
        } Adding message to output buffer: type: BackgroundInvoke, message: ${printMessageAsJson(
          msg
        )}`
      );
      this.send(BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, msg);
    }

    // We don't care about the result, just resolve the promise. Return empty result
    // This is a dirty solution. We need to return a Promise<Uint8Array> because that is what the generated client by proto-ts expects...
    // We need to find a better solution here...
    return new Uint8Array();
  }

  async invoke(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (!this.isValidState("invoke")) {
      return Promise.reject();
    }

    let suspensionTimeout: NodeJS.Timeout;

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();

      const msg = InvokeEntryMessage.create({
        serviceName: service,
        methodName: method,
        parameter: Buffer.from(data),
      });
      this.storePendingMsg(
        this.currentJournalIndex,
        INVOKE_ENTRY_MESSAGE_TYPE,
        msg,
        resolve,
        reject
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: invoke will not be forwarded to the runtime. Expecting completion.
        return;
      }

      rlog.debug(
        `${
          this.logPrefix
        } Adding message to output buffer: type: Invoke, message: ${printMessageAsJson(
          msg
        )}`
      );
      const timeout = this.send(INVOKE_ENTRY_MESSAGE_TYPE, msg);

      // Invoke should trigger a suspension
      if (timeout) {
        suspensionTimeout = timeout;
      } else {
        throw new Error(
          "Illegal state: An invoke should always set a suspension timeout"
        );
      }
    })
      .then((result) => {
        return result as Uint8Array;
      })
      .finally(() => {
        // If the promise gets completed before the suspension gets triggered, then clear the timeout
        if (suspensionTimeout) {
          clearTimeout(suspensionTimeout);
        }
      });
  }

  /**
   * When you call inBackground, a flag is set that you want the nested call to be executed in the background.
   * Then you use the client to do the call to the other Restate service.
   * When you do the call, the overridden request method gets called.
   * That one checks if the inBackgroundFlag is set.
   * If so, it doesn't care about a response and just returns back an empty UInt8Array, and otherwise it waits for the response.
   * The reason for this is that we use the generated clients of proto-ts to do invokes.
   * And we override the request method that is called by that client to do the Restate related things.
   * The request method of the proto-ts client requires returning a Promise.
   * So until we find a cleaner solution for this, in which we can still use the generated clients but are not required to return a promise,
   * this will return a void Promise.
   * @param call
   */
  async inBackground<T>(call: () => Promise<T>): Promise<void> {
    if (!this.isValidState("inBackground")) {
      return Promise.reject();
    }

    this.inBackgroundCallFlag = true;
    await call();
    this.inBackgroundCallFlag = false;
  }

  sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    // We don't call this.validate because we want different behavior for sideEffects,
    // but we still want to check if the state machine is closed.
    this.failIfClosed();

    return new Promise((resolve, reject) => {
      if (this.inSideEffectFlag) {
        const nestedSideEffectFailure: Failure = Failure.create({
          code: 13,
          message: `You cannot do sideEffect calls from within a side effect.`,
        });
        this.method.reject(nestedSideEffectFailure);
        this.onClose();
        return;
      } else if (this.inBackgroundCallFlag) {
        const sideEffectInBackgroundFailure: Failure = Failure.create({
          code: 13,
          message:
            `Cannot do a side effect from within a background call. ` +
            "Context method inBackground() can only be used to invoke other services in the background. " +
            "e.g. ctx.inBackground(() => client.greet(my_request))",
        });
        this.method.reject(sideEffectInBackgroundFailure);
        this.onClose();
        return;
      }

      this.inSideEffectFlag = true;
      this.incrementJournalIndex();

      // This promise will be resolved when the runtime has acked the side effect value
      // This promise can be resolved with a completion with undefined value (streaming case)
      // or with a value of type T during replay.
      // If it gets resolved with a completion, we need to resolve the outer promise with the result of executing fn()
      // If we are replaying, it needs to be resolved by the value of the replayed SideEffectEntryMessage.
      // For journal mismatch checks during replay,
      // we only check the message type to avoid having to re-execute the user code.
      const promiseToResolve = new Promise<T | undefined>(
        (resolveWithCompletion, rejectWithCompletion) => {
          this.storePendingMsg(
            this.currentJournalIndex,
            SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            undefined,
            resolveWithCompletion,
            rejectWithCompletion
          );
        }
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: side effect will be ignored. Expecting completion.
        // During replay, the promise for the runtime ack will get resolved
        // with a SideEffectEntryMessage with a value of type T or a Failure.
        return promiseToResolve.then(
          (value) => {
            resolve(value as T);
          },
          (failure) => {
            reject(failure);
          }
        );
      }

      fn()
        .then((value) => {
          const bytes =
            typeof value === "undefined"
              ? (Empty.encode(Empty.create({})).finish() as Buffer)
              : Buffer.from(JSON.stringify(value));
          const sideEffectMsg = SideEffectEntryMessage.encode(
            SideEffectEntryMessage.create({ value: bytes })
          ).finish();

          rlog.debug(
            `${
              this.logPrefix
            } Adding message to output buffer: type: SideEffect, message: ${printMessageAsJson(
              sideEffectMsg
            )}`
          );
          this.send(
            SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            sideEffectMsg,
            false,
            undefined,
            true
          );
          this.inSideEffectFlag = false;

          // When the runtime has acked the sideEffect with an empty completion,
          // then we resolve the promise with the result of the user-defined function.
          promiseToResolve.then(
            () => resolve(value),
            (failure) => reject(failure)
          );
        })
        .catch((reason) => {
          // Reason is either a failure or an Error
          const failure: Failure =
            reason instanceof Error
              ? Failure.create({
                  code: 13,
                  message: reason.message,
                })
              : reason;

          const sideEffectMsg = SideEffectEntryMessage.encode(
            SideEffectEntryMessage.create({ failure: failure })
          ).finish();

          rlog.debug(
            `${
              this.logPrefix
            } Adding message to output buffer: type: SideEffect, message: ${printMessageAsJson(
              sideEffectMsg
            )}`
          );
          this.send(
            SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            sideEffectMsg,
            false,
            undefined,
            true
          );

          // When something went wrong, then we resolve the promise with a failure.
          promiseToResolve.then(
            () => reject(failure),
            (failureFromRuntime) => reject(failureFromRuntime)
          );
        });
    });
  }

  async sleep(millis: number): Promise<void> {
    if (!this.isValidState("sleep")) {
      return Promise.reject();
    }

    let suspensionTimeout: NodeJS.Timeout;

    return new Promise<void>((resolve, reject) => {
      this.incrementJournalIndex();

      const msg = SleepEntryMessage.create({ wakeUpTime: Date.now() + millis });
      this.storePendingMsg(
        this.currentJournalIndex,
        SLEEP_ENTRY_MESSAGE_TYPE,
        msg,
        resolve,
        reject
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: SleepEntryMessage will not be forwarded to the runtime. Expecting completion
        return;
      }

      rlog.debug(
        `${
          this.logPrefix
        } Adding message to output buffer: type: Sleep, message: ${printMessageAsJson(
          msg
        )}`
      );
      const timeout = this.send(SLEEP_ENTRY_MESSAGE_TYPE, msg);

      if (timeout) {
        suspensionTimeout = timeout;
      } else {
        throw new Error(
          "Illegal state: A sleep should always set a suspension timeout"
        );
      }
      return;
    }).finally(() => {
      clearTimeout(suspensionTimeout);
    });
  }

  // Sends the message and returns the suspensionMillis if set
  // Note that onCallSuccess and onCallFailure do not use this and send the message straight over the connection.
  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): NodeJS.Timeout | void {
    if (this.state === ExecutionState.CLOSED) {
      rlog.debug(
        "State machine is closed. Not sending message " +
          printMessageAsJson(message)
      );
      return;
    }

    // send the message
    // Right now for bidi streaming mode, we flush after every message.
    this.connection.send(
      new Message(
        messageType,
        message,
        completedFlag,
        protocolVersion,
        requiresAckFlag
      )
    );

    // If the message type requires a suspension for this protocol mode (set in constructor),
    // then set a timeout to send the suspension message.
    // The suspension will only be sent if the timeout is not canceled due to a completion.
    if (this.suspensionTriggers.includes(messageType)) {
      return setTimeout(() => {
        const completableIndices = [...this.indexToPendingMsgMap.keys()];

        // If the state is not processing anymore then we either already send a suspension
        // or something else bad happened...
        if (this.state === ExecutionState.PROCESSING) {
          // There need to be journal entries to complete, otherwise this timeout should have been removed.
          if (completableIndices.length > 0) {
            this.connection.send(
              new Message(
                SUSPENSION_MESSAGE_TYPE,
                SuspensionMessage.create({
                  entryIndexes: completableIndices,
                }),
                undefined,
                undefined,
                undefined
              )
            );

            this.onClose();
            this.connection.end();
          } else {
            // leads to onCallFailure call
            this.method.reject(
              new Error(
                "Illegal state: Not able to send suspension message because no pending promises. " +
                  "This timeout should have been removed."
              )
            );
          }
        }
      }, this.suspensionMillis);
    }
  }

  // Called for every incoming message from the runtime: start messages, input messages and replay messages.
  onIncomingMessage(msg: Message) {
    switch (msg.messageType) {
      case START_MESSAGE_TYPE: {
        this.handleStartMessage(msg.message as StartMessage);
        break;
      }
      case COMPLETION_MESSAGE_TYPE: {
        this.handleCompletionMessage(msg.message as CompletionMessage);
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        this.handleInputMessage(msg.message as PollInputStreamEntryMessage);
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        this.handleGetStateMessage(msg.message as GetStateEntryMessage);
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE: {
        this.handleSetStateMessage(msg.message as SetStateEntryMessage);
        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        this.handleClearStateMessage(msg.message as ClearStateEntryMessage);
        break;
      }
      case SLEEP_ENTRY_MESSAGE_TYPE: {
        this.handleSleepCompletionMessage(msg.message as SleepEntryMessage);
        break;
      }
      case INVOKE_ENTRY_MESSAGE_TYPE: {
        this.handleInvokeEntryMessage(msg.message as InvokeEntryMessage);
        break;
      }
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        this.handleInBackgroundInvokeMessage(
          msg.message as BackgroundInvokeEntryMessage
        );
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        this.handleAwakeableMessage(msg.message as AwakeableEntryMessage);
        break;
      }
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        this.handleCompleteAwakeableMessage(
          msg.message as CompleteAwakeableEntryMessage
        );
        break;
      }
      case SIDE_EFFECT_ENTRY_MESSAGE_TYPE: {
        this.handleSideEffectMessage(msg.message as Uint8Array);
        break;
      }
      default: {
        // leads to onCallFailure call
        this.method.reject(
          new Error(
            `Received unkown message type from the runtime: { message_type: ${msg.messageType}, message: ${msg.message} }`
          )
        );
      }
    }
  }

  handleStartMessage(m: StartMessage): void {
    this.nbEntriesToReplay = m.knownEntries;
    this.invocationId = m.invocationId;
    this.instanceKey = m.instanceKey;

    this.transitionState(ExecutionState.REPLAYING);
    if (this.nbEntriesToReplay === 0) {
      // No entries to replay so switching to PROCESSING state
      this.transitionState(ExecutionState.PROCESSING);
    }
  }

  handleInputMessage(m: PollInputStreamEntryMessage) {
    this.invocationIdString = uuidV7FromBuffer(this.invocationId);
    this.logPrefix = `[${this.serviceName}] [${this.method.method.name}] [${this.invocationIdString}]`;
    rlog.debug(
      `${this.logPrefix} Received input message: ${printMessageAsJson(m)}`
    );

    this.method.invoke(this, m.value).then(
      (value) => this.onCallSuccess(value),
      (failure) => this.onCallFailure(failure)
    );
  }

  handleCompletionMessage(m: CompletionMessage) {
    if (this.state === ExecutionState.CLOSED) {
      rlog.debug(
        "State machine is closed. Not processing completion message: " +
          printMessageAsJson(m)
      );
      return;
    }

    rlog.debug(
      `${
        this.logPrefix
      } Received new completion from the runtime: ${printMessageAsJson(m)}`
    );

    if (this.state === ExecutionState.REPLAYING) {
      // leads to onCallFailure call
      this.method.reject(
        new Error(
          "Illegal state: received completion message but still in replay state."
        )
      );
    }

    // It is possible that value, empty and failure are all undefined.
    this.handlePendingMessage(
      m.entryIndex,
      COMPLETION_MESSAGE_TYPE,
      m,
      () => true,
      m.value || m.empty,
      m.failure
    );
  }

  handleGetStateMessage(m: GetStateEntryMessage): void {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      GET_STATE_ENTRY_MESSAGE_TYPE,
      m,
      getStateMsgEquality,
      m.value || m.empty
    );
  }

  handleInvokeEntryMessage(m: InvokeEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      INVOKE_ENTRY_MESSAGE_TYPE,
      m,
      invokeMsgEquality,
      m.value,
      m.failure
    );
  }

  handleInBackgroundInvokeMessage(m: BackgroundInvokeEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
      m,
      invokeMsgEquality
    );
  }

  handleSetStateMessage(m: SetStateEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      SET_STATE_ENTRY_MESSAGE_TYPE,
      m,
      setStateMsgEquality
    );
  }

  handleClearStateMessage(m: ClearStateEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      m,
      clearStateMsgEquality
    );
  }

  handleSideEffectMessage(m: Uint8Array) {
    this.checkIfInReplay();

    const msg: SideEffectEntryMessage = SideEffectEntryMessage.decode(
      m as Uint8Array
    );

    if (msg.value != undefined) {
      // We don't compare the value the side effect messages because we do not re-execute side effects upon replay,
      // so there is nothing to compare to.
      this.handlePendingMessage(
        this.replayIndex,
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        msg,
        () => true,
        JSON.parse(msg.value.toString())
      );
    } else if (msg.failure != undefined) {
      this.handlePendingMessage(
        this.replayIndex,
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        msg,
        () => true,
        undefined,
        msg.failure
      );
    }
  }

  handleAwakeableMessage(m: AwakeableEntryMessage) {
    this.checkIfInReplay();

    // Note: an AwakeableEntryMessage does not have any filled fields pre-completion so no comparison function
    this.handlePendingMessage(
      this.replayIndex,
      AWAKEABLE_ENTRY_MESSAGE_TYPE,
      m,
      () => true,
      m.value,
      m.failure
    );
  }

  handleCompleteAwakeableMessage(m: CompleteAwakeableEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
      m,
      completeAwakeableMsgEquality
    );
  }

  handleSleepCompletionMessage(m: SleepEntryMessage) {
    this.checkIfInReplay();
    this.handlePendingMessage(
      this.replayIndex,
      SLEEP_ENTRY_MESSAGE_TYPE,
      m,
      () => true,
      m.result
    );
  }

  checkIfInReplay() {
    this.failIfClosed();

    // Compare current index in the replay (starts at 0) to the number of entries to replay (starts at 1)
    if (this.replayIndex < this.nbEntriesToReplay) {
      this.replayIndex++;
    } else {
      // leads to onCallFailure call
      this.method.reject(
        new Error(
          "Illegal state: We received a replay message from the runtime but we are not in replay mode."
        )
      );
    }
  }

  failIfClosed() {
    if (this.state === ExecutionState.CLOSED) {
      throw new Error("State machine is closed. Canceling all execution");
    }
  }

  transitionState(newExecState: ExecutionState): void {
    this.failIfClosed();
    this.state = newExecState;
  }

  incrementJournalIndex(): void {
    this.currentJournalIndex++;

    if (
      this.currentJournalIndex === this.nbEntriesToReplay &&
      this.state === ExecutionState.REPLAYING
    ) {
      this.transitionState(ExecutionState.PROCESSING);
    }
  }

  storePendingMsg(
    journalIndex: number,
    messageType: bigint,
    message?: ProtocolMessage | Uint8Array,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    resolve?: (value: any) => void,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    reject?: (value: any) => void
  ) {
    // If we are replaying, the completion may have arrived before the user code got there.
    // Otherwise, add to map.
    // TODO make this more efficient and only add it to the map if we don't have the result ready
    this.indexToPendingMsgMap.set(
      journalIndex,
      new PendingMessage(messageType, message, resolve, reject)
    );
    if (
      this.state === ExecutionState.REPLAYING &&
      this.outOfOrderReplayMessages.has(journalIndex)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const completionResult = this.outOfOrderReplayMessages.get(journalIndex)!;
      this.handlePendingMessage(
        completionResult.journalIndex,
        completionResult.messageType,
        completionResult.message,
        completionResult.comparisonFct,
        completionResult.value,
        completionResult.failure
      );
      this.outOfOrderReplayMessages.delete(journalIndex);
    }
  }

  /**
   * Used to resolve the pending messages/user actions/promises
   * @param journalIndex: journal index for which we are resolving the result
   * @param resultMessageType: the message type as expected by the runtime replay
   * @param resultMessage: the message as expected by the runtime replay
   * @param comparisonFct: a function to compare equality for this message type (Different for every message type)
   * @param value: the value that is returned from the runtime as the
   * @param failure: the failure message of the completion
   */
  handlePendingMessage<T, I>(
    journalIndex: number,
    resultMessageType: bigint, // only for journal mismatch checks during replay
    resultMessage: I, // only for journal mismatch checks during replay
    comparisonFct: (msg1: I, msg2: I) => boolean, // only for journal mismatch checks during replay
    value?: T,
    failure?: Failure
  ) {
    const optionalPendingMessage = this.indexToPendingMsgMap.get(journalIndex);

    if (optionalPendingMessage === undefined) {
      // During replay, the replay completion messages might arrive before we got to that point in the user code.
      // In that case, we wouldn't find a promise yet. So add the message to the map.
      if (this.state === ExecutionState.REPLAYING) {
        this.outOfOrderReplayMessages.set(journalIndex, {
          journalIndex: journalIndex,
          messageType: resultMessageType,
          message: resultMessage,
          comparisonFct: comparisonFct,
          value: value,
          failure: failure,
        });
        return;
      } else {
        // leads to onCallFailure call
        this.method.reject(
          new Error(
            `No pending message found for this journal index: ${journalIndex}`
          )
        );
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pendingMessage: PendingMessage = optionalPendingMessage!;

    if (
      this.state === ExecutionState.REPLAYING &&
      (pendingMessage.messageType !== resultMessageType ||
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        !comparisonFct(resultMessage, pendingMessage.message! as I))
    ) {
      // leads to onCallFailure call
      this.method.reject(
        new Error(`Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!
      The journal entry at position ${journalIndex} was:
      - In the user code: type: ${
        pendingMessage.messageType
      }, message:${printMessageAsJson(pendingMessage.message)}
      - In the replayed messages: type: ${resultMessageType}, message: ${printMessageAsJson(
          resultMessage
        )}`)
      );
    }

    // If we do not require a result, then just remove the message from the map.
    // Replay validation for journal mismatches has succeeded when we end up here.
    else if (
      pendingMessage.messageType === SET_STATE_ENTRY_MESSAGE_TYPE ||
      pendingMessage.messageType === CLEAR_STATE_ENTRY_MESSAGE_TYPE ||
      pendingMessage.messageType === COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE ||
      pendingMessage.messageType === BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE
    ) {
      this.indexToPendingMsgMap.delete(journalIndex);
    }

    // If we do require a result and have a result then resolve or reject the promise and remove the pending message from the map
    else if (value !== undefined) {
      if (pendingMessage.resolve !== undefined) {
        pendingMessage.resolve(value);
        this.indexToPendingMsgMap.delete(journalIndex);
      } else {
        // leads to onCallFailure call
        this.method.reject(
          new Error(
            "SDK bug: No resolve method found to resolve the pending message."
          )
        );
      }
    } else if (failure !== undefined) {
      if (pendingMessage.reject !== undefined) {
        pendingMessage.reject(failure);
        this.indexToPendingMsgMap.delete(journalIndex);
      } else {
        // leads to onCallFailure call
        this.method.reject(
          new Error(
            "SDK bug: No resolve method found to resolve the pending message."
          )
        );
      }
    }
    // In case of a side effect completion, we don't get a value or failure back but still need to ack the completion.
    else if (pendingMessage.messageType === SIDE_EFFECT_ENTRY_MESSAGE_TYPE) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      pendingMessage.resolve!(undefined);
      this.indexToPendingMsgMap.delete(journalIndex);
    }
  }

  /**
   * Checks if we are in a valid state to execute the action.
   * Checks:
   * - if the state machine is not closed
   * - if we are not doing a context call from within a side effect
   * - if we are not doing an invalid context call from within an inBackground call
   */
  isValidState(callType: string): boolean {
    this.failIfClosed();
    if (this.inSideEffectFlag) {
      this.method.reject(
        Failure.create({
          code: 13,
          message: `You cannot do ${callType} calls from within a side effect.`,
        })
      );
      this.onClose();
      return false;
    } else if (this.inBackgroundCallFlag) {
      this.method.reject(
        Failure.create({
          code: 13,
          message: `Cannot do a ${callType} from within a background call.
          Context method inBackground() can only be used to invoke other services in the background.
          e.g. ctx.inBackground(() => client.greet(my_request))`,
        })
      );
      this.onClose();
      return false;
    } else {
      return true;
    }
  }

  onCallSuccess(result: Uint8Array) {
    const msg = OutputStreamEntryMessage.create({ value: Buffer.from(result) });
    rlog.debug(
      `${
        this.logPrefix
      } Call ended successful, output message: ${printMessageAsJson(msg)}`
    );
    // We send the message straight over the connection
    this.connection.send(new Message(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, msg));
    this.onClose();
    this.connection.end();
  }

  onCallFailure(e: Error | Failure) {
    if (e instanceof Error) {
      rlog.warn(`${this.logPrefix} Call failed: ${e.message} - ${e.stack}`);
    } else {
      rlog.warn(`${this.logPrefix} Call failed: ${printMessageAsJson(e)}`);
    }

    // We send the message straight over the connection
    // We do not use this.send because that does not allow us to send back failures after the state machine was closed.
    this.connection.send(
      new Message(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message: `Uncaught exception for invocation id ${this.invocationIdString}: ${e.message}`,
          }),
        })
      )
    );
    this.onClose();
    this.connection.end();
  }

  onClose() {
    // done.
    if (this.state !== ExecutionState.CLOSED) {
      rlog.debug("Closing the state machine");
      this.transitionState(ExecutionState.CLOSED);
    }
  }
}
