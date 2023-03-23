"use strict";

import { Connection } from "./bidirectional_server";
import { HostedGrpcServiceMethod } from "./core";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
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
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SLEEP_ENTRY_MESSAGE_TYPE,
  SleepEntryMessage,
  START_MESSAGE_TYPE,
  StartMessage,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
} from "./protocol_stream";
import { RestateContext } from "./context";
import { AwakeableIdentifier, ProtocolMessage, PromiseHandler } from "./types";
import { Failure } from "./generated/proto/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";

enum ExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}

export class DurableExecutionStateMachine<I, O> implements RestateContext {
  private state: ExecutionState = ExecutionState.WAITING_FOR_START;

  // Obtained after StartMessage
  // You need access to these three fields within your service, so you can deliver them to external systems to completer awakeables
  public instanceKey!: Buffer;
  public serviceName: string;
  public invocationId!: Buffer;
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
  private outOfOrderReplayMessages: Map<number, any> = new Map();

  constructor(
    private readonly connection: Connection,
    private readonly method: HostedGrpcServiceMethod<I, O>
  ) {
    connection.onMessage(this.onIncomingMessage.bind(this));
    connection.onClose(this.onClose.bind(this));
    this.serviceName = method.service;
  }

  async get<T>(name: string): Promise<T | null> {
    console.debug("Service called getState: " + name);

    this.validate("get state");

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "In replay mode: GetState message will not be forwarded to the runtime. Expecting completion"
        );
        return;
      }

      console.debug("Forward the GetStateEntryMessage to the runtime");
      this.connection.send(
        GET_STATE_ENTRY_MESSAGE_TYPE,
        GetStateEntryMessage.create({ key: Buffer.from(name) })
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
    console.debug(
      "Service called setState: " + name + " - " + JSON.stringify(value)
    );

    this.validate("set state");

    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      console.debug(
        "In replay mode: SetState message will not be forwarded to the runtime. Expecting completion"
      );
      return;
    }

    console.debug("Forward the SetStateEntryMessage to the runtime");
    const bytes = Buffer.from(JSON.stringify(value));
    this.connection.send(
      SET_STATE_ENTRY_MESSAGE_TYPE,
      SetStateEntryMessage.create({
        key: Buffer.from(name, "utf8"),
        value: bytes,
      })
    );
  }

  clear(name: string): void {
    console.debug("Service called clearState: " + name);

    this.validate("clear state");

    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      console.debug(
        "In replay mode: ClearState message will not be forwarded to the runtime. Expecting completion"
      );
      return;
    }

    console.debug("Forward the ClearStateEntryMessage to the runtime");
    this.connection.send(
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      ClearStateEntryMessage.create({ key: Buffer.from(name, "utf8") })
    );
  }

  async awakeable<T>(): Promise<T> {
    console.debug("Service called awakeable");

    this.validate("awakeable");

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "In replay mode: awakeable message will not be forwarded to the runtime. Expecting completion"
        );
        return;
      }

      console.debug("Forward the Awakeable message to the runtime");
      this.connection.send(
        AWAKEABLE_ENTRY_MESSAGE_TYPE,
        AwakeableEntryMessage.create()
      );
    }).then<T>((result: Buffer) => {
      console.debug(
        "Received the following result: " + JSON.parse(result.toString())
      );
      return JSON.parse(result.toString()) as T;
    });
  }

  completeAwakeable<T>(id: AwakeableIdentifier, payload: T): void {
    console.debug("Service called completeAwakeable");

    this.validate("completeAwakeable");

    this.incrementJournalIndex();

    if (this.state === ExecutionState.REPLAYING) {
      console.debug(
        "In replay mode: CompleteAwakeable message will not be forwarded to the runtime. Expecting completion"
      );
      return;
    }

    console.debug("Forward the CompleteAwakeable message to the runtime");
    this.connection.send(
      COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
      CompleteAwakeableEntryMessage.create({
        serviceName: id.serviceName,
        instanceKey: id.instanceKey,
        invocationId: id.invocationId,
        entryIndex: id.entryIndex,
        payload: Buffer.from(JSON.stringify(payload)),
      })
    );
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    console.debug(`Service called other service: ${service} / ${method}`);

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
      console.debug(
        "In replay mode: background invoke will not be forwarded to the runtime. Expecting journal entry."
      );
    } else {
      console.debug("Forward the BackgroundInvokeEntryMessage to the runtime");
      this.connection.send(
        BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
        BackgroundInvokeEntryMessage.create({
          serviceName: service,
          methodName: method,
          parameter: Buffer.from(data),
        })
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

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "In replay mode: invoke will not be forwarded to the runtime. Expecting completion"
        );
        return;
      }

      console.debug("Forward the InvokeEntryMessage to the runtime");
      this.connection.send(
        INVOKE_ENTRY_MESSAGE_TYPE,
        InvokeEntryMessage.create({
          serviceName: service,
          methodName: method,
          parameter: Buffer.from(data),
        })
      );
    }).then((result) => {
      return result as Uint8Array;
    });
  }

  async inBackground<T>(call: () => Promise<T>): Promise<void> {
    this.validate("inBackground");

    this.inBackgroundCallFlag = true;
    call();
    this.inBackgroundCallFlag = false;
  }

  async sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    console.debug("Service used side effect");
    return new Promise((resolve, reject) => {
      const wasAlreadyInSideEffect = this.inSideEffectFlag;
      this.inSideEffectFlag = true;
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (wasAlreadyInSideEffect) {
        console.debug("Rejecting the promise: was already in a side effect.");
        const failure: Failure = Failure.create({
          code: 13,
          message: `You cannot do sideEffect calls from within a side effect.`,
        });
        this.connection.send(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          SideEffectEntryMessage.create({ failure: failure }),
          false, true
        );
        return;
      } else if (this.inBackgroundCallFlag) {
        console.debug("Rejecting the promise");
        const failure: Failure = Failure.create({
          code: 13,
          message:
            `Cannot do a side effect from within a sideEffect call. ` +
            "Context method inBackground() can only be used to invoke other services in the background. " +
            "e.g. ctx.inBackground(() => client.greet(my_request))",
        });
        this.connection.send(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          SideEffectEntryMessage.create({ failure: failure }),
          false, true
        );
        return;
      }

      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "In replay mode: side effect will be ignored. Expecting completion"
        );
        return;
      }

      fn()
        .then((value) => {
          console.debug("Sending side effect to the runtime: " +value)
          const bytes = Buffer.from(JSON.stringify(value));
          this.connection.send(
            SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            SideEffectEntryMessage.encode(SideEffectEntryMessage.create({ value: bytes })).finish(),
            false, true
          );
          this.inSideEffectFlag = false;
        })
        .catch((reason) => {
          const failure: Failure = Failure.create({
            code: 13,
            message: reason.stack,
          });
          this.connection.send(
            SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
            SideEffectEntryMessage.create({ failure: failure }),
            false, true
          );
        });
    });
  }

  async sleep(millis: number): Promise<void> {
    console.debug("Service called sleep");

    this.validate("sleep");

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve, reject);

      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "In replay mode: SleepEntryMessage will not be forwarded to the runtime. Expecting completion"
        );
        return;
      }

      console.debug("Forward the SleepEntryMessage to the runtime");
      // Forward to runtime
      this.connection.send(
        SLEEP_ENTRY_MESSAGE_TYPE,
        SleepEntryMessage.create({ wakeUpTime: Date.now() + millis })
      );
    });
  }

  // Called for every incoming message from the runtime: start messages, input messages and replay messages.
  onIncomingMessage(
    message_type: bigint,
    message: ProtocolMessage | Uint8Array,
    completed_flag?: boolean,
    protocol_version?: number,
    requires_ack_flag?: boolean
  ) {
    switch (message_type) {
      case START_MESSAGE_TYPE: {
        this.handleStartMessage(message as StartMessage);
        break;
      }
      case COMPLETION_MESSAGE_TYPE: {
        this.handleCompletionMessage(message as CompletionMessage);
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        this.handleInputMessage(message as PollInputStreamEntryMessage);
        break;
      }
      case GET_STATE_ENTRY_MESSAGE_TYPE: {
        this.handleGetStateMessage(message as GetStateEntryMessage);
        break;
      }
      case SET_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as SetStateEntryMessage;
        console.debug("Received SetStateEntryMessage: " + JSON.stringify(m));
        this.checkIfInReplay();
        break;
      }
      case CLEAR_STATE_ENTRY_MESSAGE_TYPE: {
        const m = message as ClearStateEntryMessage;
        console.debug("Received ClearStateEntryMessage: " + JSON.stringify(m));
        this.checkIfInReplay();
        break;
      }
      case SLEEP_ENTRY_MESSAGE_TYPE: {
        this.handleSleepCompletionMessage(message as SleepEntryMessage);
        break;
      }
      case INVOKE_ENTRY_MESSAGE_TYPE: {
        this.handleInvokeEntryMessage(message as InvokeEntryMessage);
        break;
      }
      case BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE: {
        const m = message as BackgroundInvokeEntryMessage;
        console.debug(
          "Received BackgroundInvokeEntryMessage: " + JSON.stringify(m)
        );
        this.checkIfInReplay();
        break;
      }
      case AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        this.handleAwakeableMessage(message as AwakeableEntryMessage);
        break;
      }
      case COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE: {
        const m = message as CompleteAwakeableEntryMessage;
        console.debug(
          "Received CompleteAwakeableEntryMessage: " + JSON.stringify(m)
        );
        break;
      }
      case SIDE_EFFECT_ENTRY_MESSAGE_TYPE: {
        this.handleSideEffectMessage(message as SideEffectEntryMessage);
        break;
      }
      default: {
        throw new Error(
          `Received unkown message type from the runtime: { message_type: ${message_type}, message: ${message} }`
        );
      }
    }
  }

  handleStartMessage(m: StartMessage): void {
    console.debug("Received start message: " + JSON.stringify(m));

    this.nbEntriesToReplay = m.knownEntries;
    this.invocationId = m.invocationId;
    this.instanceKey = m.instanceKey;

    this.transitionState(ExecutionState.REPLAYING);
    if (this.nbEntriesToReplay === 0) {
      console.debug("No entries to replay so switching to PROCESSING state");
      this.transitionState(ExecutionState.PROCESSING);
    }
  }

  handleInputMessage(m: PollInputStreamEntryMessage) {
    console.debug("Received input message: " + JSON.stringify(m));

    this.method.invoke(this, m.value).then(
      (value) => this.onCallSuccess(value),
      (failure) => this.onCallFailure(failure)
    );
  }

  handleCompletionMessage(m: CompletionMessage) {
    console.debug("Received completion message: " + JSON.stringify(m));

    if (this.state === ExecutionState.REPLAYING) {
      throw new Error(
        "Illegal state: received completion message but still in replay state."
      );
    }

    if (m.value !== undefined) {
      this.resolveOrRejectPromise(m.entryIndex, m.value);
    } else {
      // If the value is not set, then it is either empty or a failure
      this.resolveOrRejectPromise(m.entryIndex, m.empty, m.failure);
    }
  }

  handleGetStateMessage(m: GetStateEntryMessage): void {
    console.debug(
      "Received completed GetStateEntryMessage from runtime: " +
        JSON.stringify(m)
    );

    this.checkIfInReplay();

    if (m.value !== undefined) {
      this.resolveOrRejectPromise(this.currentJournalIndex, m.value as Buffer);
    }
    if (m.empty !== undefined) {
      this.resolveOrRejectPromise(this.currentJournalIndex, m.empty);
    } else {
      console.debug("GetStateEntryMessage not yet completed.");
    }
  }

  handleInvokeEntryMessage(m: InvokeEntryMessage) {
    console.debug("Received InvokeEntryMessage: " + JSON.stringify(m));

    this.checkIfInReplay();

    this.resolveOrRejectPromise(this.replayIndex, m.value, m.failure);
  }

  handleSideEffectMessage(m: SideEffectEntryMessage) {
    console.debug("Received SideEffectMessage: " + JSON.stringify(m));

    this.checkIfInReplay();

    if (m.value != undefined) {
      this.resolveOrRejectPromise(
        this.replayIndex,
        JSON.parse(m.value.toString())
      );
    } else {
      this.resolveOrRejectPromise(this.replayIndex, undefined, m.failure);
    }
  }

  handleAwakeableMessage(m: AwakeableEntryMessage) {
    console.debug("Received AwakeableEntryMessage: " + m.toString());

    this.checkIfInReplay();

    this.resolveOrRejectPromise(this.replayIndex, m.value, m.failure);
  }

  handleSleepCompletionMessage(m: SleepEntryMessage) {
    console.debug("Received SleepEntryMessage: " + JSON.stringify(m));

    this.checkIfInReplay();

    this.resolveOrRejectPromise(this.replayIndex, m.result);
  }

  checkIfInReplay() {
    // Compare current index in the replay (starts at 0) to the number of entries to replay (starts at 1)
    if (this.replayIndex < this.nbEntriesToReplay) {
      this.replayIndex++;
      console.debug(
        `Incremented replay index to ${this.replayIndex}. The user code journal index is at ${this.currentJournalIndex}.`
      );
    } else {
      throw new Error(
        "Illegal state: We received a replay message from the runtime but we are not in replay mode."
      );
    }
  }

  transitionState(newExecState: ExecutionState): void {
    if (this.state === ExecutionState.CLOSED) {
      // Cannot move out of closed state
      return;
    }
    console.debug(
      `Transitioning invocation state machine from ${this.state} to ${newExecState}`
    );

    this.state = newExecState;
  }

  incrementJournalIndex(): void {
    this.currentJournalIndex++;
    console.debug(
      `Incremented journal index. Journal index is now  ${this.currentJournalIndex} while known_entries is ${this.nbEntriesToReplay}`
    );

    if (
      this.currentJournalIndex === this.nbEntriesToReplay &&
      this.state === ExecutionState.REPLAYING
    ) {
      this.transitionState(ExecutionState.PROCESSING);
    }
  }

  addPromise(
    journalIndex: number,
    resolve: (value: any) => void,
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

    console.debug("Resolving the promise of journal entry " + journalIndex);
    if (value !== undefined) {
      resolveFct.resolve(value);
      this.pendingPromises.delete(journalIndex);
    } else if (failure !== undefined) {
      resolveFct.reject(failure);
      this.pendingPromises.delete(journalIndex);
    } else {
      if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          `Completion for journal index ${journalIndex} not yet received.`
        );
      } else {
        throw new Error(
          "Illegal state exception: should not receive empty completion"
        );
      }
    }
  }

  validate(callType: string) {
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
    console.debug("Call successfully completed");
    this.connection.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({ value: Buffer.from(result) })
    );
    this.connection.end();
  }

  onCallFailure(e: Error | Failure) {
    if (e instanceof Error) {
      console.warn(
        `Call failed for invocation id ${this.invocationId.toString()}: ${e.message} - ${e.stack}`
      );
    } else {
      console.warn(
        `Call failed for invocation id ${this.invocationId.toString()}: ${JSON.stringify(
          e
        )}`
      );
    }

    this.connection.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: Failure.create({
          code: 13,
          message: "Uncaught exception for invocation id " + this.invocationId.toString(),
        }),
      })
    );
    this.connection.end();
  }

  onClose() {
    // done.
    console.log(`DEBUG connection has been closed.`);
  }
}
