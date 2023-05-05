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
  SuspensionMessage
} from "./types/protocol";
import { RestateContext } from "./restate_context";
import { printMessageAsJson, uuidV7FromBuffer } from "./utils/utils";
import { Failure } from "./generated/proto/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { Empty } from "./generated/google/protobuf/empty";
import { ProtocolMode } from "./generated/proto/discovery";
import { clearTimeout } from "timers";
import { Message } from "./types/types";

enum ExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}

export class PromiseHandler {
  constructor(
    readonly resolve: (value: unknown) => void,
    readonly reject: (reason: Failure | Error) => void
  ) {}
}

export class DurableExecutionStateMachine<I, O> implements RestateContext {
  private state: ExecutionState = ExecutionState.WAITING_FOR_START;

  // Obtained after StartMessage
  // You need access to these three fields within your service, so you can deliver them to external systems to completer awakeables
  public instanceKey!: Buffer;
  public serviceName: string;
  public invocationId!: Buffer;
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

  // Promises that need to be resolved. Journal index -> resolve
  private pendingPromises: Map<number, PromiseHandler> = new Map();
  // Replay messages that arrived before the user code was at that point.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private outOfOrderReplayMessages: Map<number, any> = new Map();

  private suspensionTriggers: bigint[];
  private readonly suspensionTimeout;

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
      throw new Error(
        "Unknown protocol mode. Protocol mode does not have suspension triggers defined."
      );
    }
    this.suspensionTimeout =
      this.protocolMode === ProtocolMode.REQUEST_RESPONSE ? 0 : 100;

    connection.addOnErrorListener(() => {
      this.onClose();
    });
  }

  async get<T>(name: string): Promise<T | null> {
    this.validate("get state");

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: GetState message will not be forwarded to the runtime. Expecting completion"
        return;
      }

      const msg = GetStateEntryMessage.create({ key: Buffer.from(name) });
      console.debug(`${this.logPrefix} Adding message to output buffer: type: GetState, message: ${printMessageAsJson(msg)}`)
      this.send(
        GET_STATE_ENTRY_MESSAGE_TYPE,
        msg
      );
    }).then((result: Buffer | null) => {
      if (result == null || JSON.stringify(result) === "{}") {
        return null;
      } else {
        return JSON.parse(result.toString()) as T;
      }
    });
  }

  set<T>(name: string, value: T): void {
    this.validate("set state");
    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      // In replay mode: SetState message will not be forwarded to the runtime. Expecting completion.
      return;
    }

    const bytes = Buffer.from(JSON.stringify(value));
    const msg = SetStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
      value: bytes,
    });
    console.debug(`${this.logPrefix} Adding message to output buffer: type: SetState, message: ${printMessageAsJson(msg)}`)
    this.send(
      SET_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  clear(name: string): void {
    this.validate("clear state");
    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      //In replay mode: ClearState message will not be forwarded to the runtime. Expecting completion.
      return;
    }

    const msg = ClearStateEntryMessage.create({ key: Buffer.from(name, "utf8") });
    console.debug(`${this.logPrefix} Adding message to output buffer: type: ClearState, message: ${printMessageAsJson(msg)}`)
    this.send(
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  async awakeable<T>(): Promise<T> {
    this.validate("awakeable");

    let suspensionTimeout: NodeJS.Timeout;

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: awakeable message will not be forwarded to the runtime. Expecting completion
        return;
      }

      const msg = AwakeableEntryMessage.create();
      console.debug(`${this.logPrefix} Adding message to output buffer: type: Awakeable, message: ${printMessageAsJson(msg)}`)
      const timeout = this.send(
        AWAKEABLE_ENTRY_MESSAGE_TYPE,
        msg
      );

      // an awakeable should trigger a suspension
      if (timeout) {
        suspensionTimeout = timeout;
      } else {
        throw new Error(
          "Illegal state: An awakeable should always set a suspension timeout"
        );
      }
    }).then<T>((result: Buffer) => {
      // If the promise gets completed before the suspension gets triggered, then clear the timeout
      if (suspensionTimeout) {
        clearTimeout(suspensionTimeout);
      }

      return JSON.parse(result.toString()) as T;
    });
  }

  completeAwakeable<T>(id: AwakeableIdentifier, payload: T): void {
    this.validate("completeAwakeable");
    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      //In replay mode: CompleteAwakeable message will not be forwarded to the runtime. Expecting completion.
      return;
    }

    const msg = CompleteAwakeableEntryMessage.create({
      serviceName: id.serviceName,
      instanceKey: id.instanceKey,
      invocationId: id.invocationId,
      entryIndex: id.entryIndex,
      payload: Buffer.from(JSON.stringify(payload)),
    });
    console.debug(`${this.logPrefix} Adding message to output buffer: type: CompleteAwakeable, message: ${printMessageAsJson(msg)}`)
    this.send(
      COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
      msg
    );
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

    if (this.state === ExecutionState.REPLAYING) {
      // In replay mode: background invoke will not be forwarded to the runtime. Expecting journal entry.
    } else {
      const msg = BackgroundInvokeEntryMessage.create({
        serviceName: service,
        methodName: method,
        parameter: Buffer.from(data),
      });
      console.debug(`${this.logPrefix} Adding message to output buffer: type: BackgroundInvoke, message: ${printMessageAsJson(msg)}`)
      this.send(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        msg
      );
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
    this.validate("invoke");

    let suspensionTimeout: NodeJS.Timeout;

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: invoke will not be forwarded to the runtime. Expecting completion.
        return;
      }

      const msg = InvokeEntryMessage.create({
        serviceName: service,
        methodName: method,
        parameter: Buffer.from(data),
      });
      console.debug(`${this.logPrefix} Adding message to output buffer: type: Invoke, message: ${printMessageAsJson(msg)}`)
      const timeout = this.send(
        INVOKE_ENTRY_MESSAGE_TYPE,
        msg
      );

      // Invoke should trigger a suspension
      if (timeout) {
        suspensionTimeout = timeout;
      } else {
        throw new Error(
          "Illegal state: An invoke should always set a suspension timeout"
        );
      }
    }).then((result) => {
      // If the promise gets completed before the suspension gets triggered, then clear the timeout
      if (suspensionTimeout) {
        clearTimeout(suspensionTimeout);
      }

      return result as Uint8Array;
    });
  }

  async inBackground<T>(call: () => Promise<T>): Promise<void> {
    this.validate("inBackground");

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
        console.error(
          this.logPrefix + "Rejecting the promise: invalid user code - you cannot nest side effects."
        );
        console.trace();
        const nestedSideEffectFailure: Failure = Failure.create({
          code: 13,
          message: `You cannot do sideEffect calls from within a side effect.`,
        });
        return reject(nestedSideEffectFailure);
      } else if (this.inBackgroundCallFlag) {
        console.error(
          this.logPrefix + "Rejecting the promise: invalid user code - you cannot do a side effect inside a background call"
        );
        console.trace();
        const sideEffectInBackgroundFailure: Failure = Failure.create({
          code: 13,
          message:
            `Cannot do a side effect from within a background call. ` +
            "Context method inBackground() can only be used to invoke other services in the background. " +
            "e.g. ctx.inBackground(() => client.greet(my_request))",
        });
        return reject(sideEffectInBackgroundFailure);
      }

      this.inSideEffectFlag = true;
      this.incrementJournalIndex();

      // This promise will be resolved when the runtime has acked the side effect value
      // This promise can be resolved with a completion with undefined value (streaming case)
      // or with a value of type T during replay
      // If it gets resolved with a completion, we need to resolve the outer promise with the result of executing fn()
      // If we are replaying, it needs to be resolved by the value of the replayed SideEffectEntryMessage
      const promiseToResolve = new Promise<T | undefined>(
        (resolveWithCompletion, rejectWithCompletion) => {
          this.addPromise(
            this.currentJournalIndex,
            resolveWithCompletion,
            rejectWithCompletion
          );
        }
      );

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: side effect will be ignored. Expecting completion
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

          console.debug(`${this.logPrefix} Adding message to output buffer: type: SideEffect, message: ${printMessageAsJson(sideEffectMsg)}`)
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
          const failure: Failure = Failure.create({
            code: 13,
            message: reason.stack,
          });
          const sideEffectMsg = SideEffectEntryMessage.encode(
            SideEffectEntryMessage.create({ failure: failure })
          ).finish();

          console.debug(`${this.logPrefix} Adding message to output buffer: type: SideEffect, message: ${printMessageAsJson(sideEffectMsg)}`)
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
    this.validate("sleep");

    return new Promise<NodeJS.Timeout>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        // In replay mode: SleepEntryMessage will not be forwarded to the runtime. Expecting completion
        return;
      }

      // Forward to runtime
      const msg = SleepEntryMessage.create({ wakeUpTime: Date.now() + millis });
      console.debug(`${this.logPrefix} Adding message to output buffer: type: Sleep, message: ${printMessageAsJson(msg)}`)
      const timeout = this.send(
        SLEEP_ENTRY_MESSAGE_TYPE,
        msg
      );

      if (!timeout) {
        throw new Error(
          "Illegal state: A sleep should always set a suspension timeout"
        );
      }
      return timeout;
    }).then((timeout: NodeJS.Timeout) => {
      clearTimeout(timeout);
      return;
    });
  }

  // Sends the message and returns the suspensionTimeout if set
  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completedFlag?: boolean,
    protocolVersion?: number,
    requiresAckFlag?: boolean
  ): NodeJS.Timeout | void {
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

    // If the suspension triggers for this protocol mode (set in constructor) include the message type
    // then set a timeout to send the suspension message.
    // The suspension will only be sent if the timeout is not cancelled due to a completion.
    if (this.suspensionTriggers.includes(messageType)) {
      return setTimeout(() => {
        const completableIndices = [...this.pendingPromises.keys()];

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
            throw new Error(
              "Illegal state: Not able to send suspension message because no pending promises. " +
                "This timeout should have been removed."
            );
          }
        }
      }, this.suspensionTimeout);
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
        this.checkIfInReplay();
        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        this.checkIfInReplay();
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
        this.checkIfInReplay();
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        this.handleAwakeableMessage(msg.message as AwakeableEntryMessage);
        break;
      }
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        break;
      }
      case SIDE_EFFECT_ENTRY_MESSAGE_TYPE: {
        this.handleSideEffectMessage(msg.message as Uint8Array);
        break;
      }
      default: {
        throw new Error(
          `Received unkown message type from the runtime: { message_type: ${msg.messageType}, message: ${msg.message} }`
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
    const invocationIdString = uuidV7FromBuffer(this.invocationId);
    this.logPrefix = `[${this.serviceName}] [${this.method.method.name}] [${invocationIdString}]`;
    console.debug(`${this.logPrefix} Received input message: ${printMessageAsJson(m)}`);


    this.method.invoke(this, m.value).then(
      (value) => this.onCallSuccess(value),
      (failure) => this.onCallFailure(failure)
    );
  }

  handleCompletionMessage(m: CompletionMessage) {
    this.failIfClosed();

    if (this.state === ExecutionState.REPLAYING) {
      throw new Error(
        "Illegal state: received completion message but still in replay state."
      );
    }

    if (m.value !== undefined) {
      this.resolveOrRejectPromise(m.entryIndex, m.value);
    } else {
      // If the value is not set, then it is either Empty, a failure, or undefined (side effect)
      this.resolveOrRejectPromise(m.entryIndex, m.empty, m.failure);
    }
  }

  handleGetStateMessage(m: GetStateEntryMessage): void {
    this.checkIfInReplay();

    if (m.value !== undefined) {
      this.resolveOrRejectPromise(this.currentJournalIndex, m.value as Buffer);
    } else if (m.empty !== undefined) {
      this.resolveOrRejectPromise(this.currentJournalIndex, m.empty);
    }
    // Else: GetStateEntryMessage not yet completed. So we wait for a completion
  }

  handleInvokeEntryMessage(m: InvokeEntryMessage) {
    this.checkIfInReplay();

    this.resolveOrRejectPromise(this.replayIndex, m.value, m.failure);
  }

  handleSideEffectMessage(m: Uint8Array) {
    this.checkIfInReplay();

    const msg: SideEffectEntryMessage = SideEffectEntryMessage.decode(
      m as Uint8Array
    );

    if (msg.value != undefined) {
      this.resolveOrRejectPromise(
        this.replayIndex,
        JSON.parse(msg.value.toString())
      );
    } else {
      this.resolveOrRejectPromise(this.replayIndex, undefined, msg.failure);
    }
  }

  handleAwakeableMessage(m: AwakeableEntryMessage) {
    this.checkIfInReplay();
    this.resolveOrRejectPromise(this.replayIndex, m.value, m.failure);
  }

  handleSleepCompletionMessage(m: SleepEntryMessage) {
    this.checkIfInReplay();
    this.resolveOrRejectPromise(this.replayIndex, m.result);
  }

  checkIfInReplay() {
    this.failIfClosed();

    // Compare current index in the replay (starts at 0) to the number of entries to replay (starts at 1)
    if (this.replayIndex < this.nbEntriesToReplay) {
      this.replayIndex++;
    } else {
      throw new Error(
        "Illegal state: We received a replay message from the runtime but we are not in replay mode."
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

  addPromise(
    journalIndex: number,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    resolve: (value: any) => void,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    reject: (value: any) => void
  ) {
    // If we are replaying, the completion may have arrived before the user code got there.
    // Otherwise, add to map.
    if (
      this.state === ExecutionState.REPLAYING &&
      this.outOfOrderReplayMessages.has(journalIndex)
    ) {
      // Resolving promise
      // TODO we should only resolve it if the response was not a failure
      resolve(this.outOfOrderReplayMessages.get(journalIndex));
      this.outOfOrderReplayMessages.delete(journalIndex);
    } else {
      this.pendingPromises.set(
        journalIndex,
        new PromiseHandler(resolve, reject)
      );
    }
  }

  resolveOrRejectPromise<T>(
    journalIndex: number,
    value?: T | undefined,
    failure?: Failure | undefined
  ) {
    const resolveFct = this.pendingPromises.get(journalIndex);
    if (!resolveFct) {
      // During replay, the replay completion messages might arrive before we got to that point in the user code.
      // In that case, we wouldn't find a promise yet. So add the message to the map.
      if (this.state === ExecutionState.REPLAYING) {
        this.outOfOrderReplayMessages.set(this.replayIndex, value);
        return;
      } else {
        throw new Error(`Promise for journal index ${journalIndex} not found`);
      }
    }

    if (failure !== undefined) {
      if(this.state !== ExecutionState.REPLAYING){
        console.debug(`${this.logPrefix} Received new completion from the runtime: ${printMessageAsJson(failure)}`)
      }
      resolveFct.reject(failure);
      this.pendingPromises.delete(journalIndex);
    } else {
      // value can be of type T, empty (e.g. getState) or undefined (e.g. sideEffect)
      resolveFct.resolve(value);
      this.pendingPromises.delete(journalIndex);
    }
  }

  validate(callType: string) {
    this.failIfClosed();
    if (this.inSideEffectFlag) {
      throw new Error(
        `You cannot do ${callType} calls from within a side effect.`
      );
    } else if (this.inBackgroundCallFlag) {
      throw new Error(
        `Cannot do a ${callType} from within a background call. ` +
          "Context method inBackground() can only be used to invoke other services in the background. " +
          "e.g. ctx.inBackground(() => client.greet(my_request))"
      );
    }
  }

  onCallSuccess(result: Uint8Array) {
    const msg = OutputStreamEntryMessage.create({ value: Buffer.from(result) })
    console.debug(`${this.logPrefix} Call ended successful, output message: ${printMessageAsJson(msg)}`)
    this.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      msg
    );
    this.connection.end();
  }

  onCallFailure(e: Error | Failure) {
    if (e instanceof Error) {
      console.warn(
        `${this.logPrefix} Call failed: ${
          e.message
        } - ${e.stack}`
      );
    } else {
      console.warn(
        `${this.logPrefix} Call failed: ${printMessageAsJson(
          e
        )}`
      );
    }

    this.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: Failure.create({
          code: 13,
          message:
            "Uncaught exception for invocation id " +
            this.invocationId.toString(),
        }),
      })
    );
    this.connection.end();
  }

  onClose() {
    // done.
    this.transitionState(ExecutionState.CLOSED);
  }
}
