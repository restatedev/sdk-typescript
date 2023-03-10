/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use strict";

import { Connection } from "./bidirectional_server";
import { HostedGrpcServiceMethod } from "./core";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableEntryMessage,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  BackgroundInvokeEntryMessage,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
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
  SLEEP_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
} from "./protocol_stream";
import { RestateContext } from "./context";
import { AwakeableIdentifier, SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "./types";
import { GreetResponse } from "./generated/proto/example";
import _m0 from "protobufjs/minimal";

enum ExecutionState {
  WAITING_FOR_START = "WAITING_FOR_START",
  REPLAYING = "REPLAYING",
  PROCESSING = "PROCESSING",
  CLOSED = "CLOSED",
}

export class DurableExecutionStateMachine<I, O> implements RestateContext {
  private state: ExecutionState = ExecutionState.WAITING_FOR_START;

  // Obtained after StartMessage
  private instanceKey!: Buffer;
  private serviceName: string;
  private invocationId!: Buffer;
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

  // Promises that need to be resolved. Journal index -> promise
  private pendingPromises: Map<number, (value: any) => void> = new Map();
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

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve);

      if (this.state === ExecutionState.PROCESSING) {
        console.debug("Forward the GetStateEntryMessage to the runtime");
        // Forward to runtime
        this.connection.send(
          GET_STATE_ENTRY_MESSAGE_TYPE,
          GetStateEntryMessage.create({ key: Buffer.from(name) })
        );
      } else {
        console.debug(
          "In replay mode: GetState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry."
        );
      }
    })
      .then<T>((result: Buffer) => {
        return JSON.parse(result.toString()) as T;
      })
      .catch<null>(() => {
        return null;
      });
  }

  async set<T>(name: string, value: T): Promise<void> {
    console.debug(
      "Service called setState: " + name + " - " + JSON.stringify(value)
    );
    const str = JSON.stringify(value);
    const bytes = Buffer.from(str);

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();

      if (this.state === ExecutionState.PROCESSING) {
        console.debug("Forward the SetStateEntryMessage to the runtime");
        // Forward to runtime
        this.connection.send(
          SET_STATE_ENTRY_MESSAGE_TYPE,
          SetStateEntryMessage.create({
            key: Buffer.from(name, "utf8"),
            value: bytes,
          })
        );
      } else {
        console.debug(
          "In replay mode: SetState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry."
        );
      }
    });
  }

  async clear(name: string): Promise<void> {
    console.debug("Service called clearState: " + name);
    this.incrementJournalIndex();

    if (this.state === ExecutionState.PROCESSING) {
      console.debug("Forward the ClearStateEntryMessage to the runtime");
      // Forward to runtime
      this.connection.send(
        CLEAR_STATE_ENTRY_MESSAGE_TYPE,
        ClearStateEntryMessage.create({ key: Buffer.from(name, "utf8") })
      );
    } else {
      console.debug(
        "In replay mode: ClearState message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry."
      );
    }
  }

  async awakeable<T>(): Promise<T> {
    console.debug("Service called awakeable");

    return new Promise<Buffer>((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve);

      if (this.state === ExecutionState.PROCESSING) {
        console.debug("Forward the Awakeable message to the runtime");

        // TODO: Don't we need to use the same proto message here as in the Java SDK?
        // A Java service needs to be able to awake a Typescript service?
        const awakeableIdentifier = new AwakeableIdentifier(
          this.serviceName,
          this.instanceKey,
          this.invocationId,
          this.currentJournalIndex
        );
        this.connection.send(
          AWAKEABLE_ENTRY_MESSAGE_TYPE,
          AwakeableEntryMessage.create({
            value: Buffer.from(JSON.stringify(awakeableIdentifier)),
          })
        );
      } else {
        console.debug(
          "In replay mode: the message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry."
        );
      }
    })
      .then<T>((result: Buffer) => {
        console.debug(
          "Received the following result: " + JSON.parse(result.toString())
        );
        return JSON.parse(result.toString()) as T;
      })
      .catch((reason) => {
        console.debug(reason);
        return "" as T;
      });
  }

  async completeAwakeable<T>(
    id: AwakeableIdentifier,
    payload: T
  ): Promise<void> {
    console.debug("Service called completeAwakeable");

    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve);

      if (this.state === ExecutionState.PROCESSING) {
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
      resolve();
    });
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

  invokeInBackground(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();

      if (this.state === ExecutionState.PROCESSING) {
        console.debug(
          "Forward the BackgroundInvokeEntryMessage to the runtime"
        );
        this.connection.send(
          BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
          BackgroundInvokeEntryMessage.create({
            serviceName: service,
            methodName: method,
            parameter: Buffer.from(data),
          })
        );
      } else if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "Ignoring background invoke call request from user. We are in replay mode. This will be fulfilled by the next journal entry."
        );
      } else {
        throw new Error(
          "Illegal state: cannot execute background calls when in state " +
            this.state
        );
      }
      // We don't care about the result, just resolve the promise. Return empty result
      resolve(new Uint8Array());
    });
  }

  invoke(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.incrementJournalIndex();
      this.addPromise(this.currentJournalIndex, resolve);

      if (this.state === ExecutionState.PROCESSING) {
        console.debug("Forward the InvokeEntryMessage to the runtime");
        this.connection.send(
          INVOKE_ENTRY_MESSAGE_TYPE,
          InvokeEntryMessage.create({
            serviceName: service,
            methodName: method,
            parameter: Buffer.from(data),
          })
        );
      } else if (this.state === ExecutionState.REPLAYING) {
        console.debug(
          "Ignoring invoke call request from user. We are in replay mode. This will be fulfilled by the next journal entry."
        );
      } else {
        throw new Error(
          `Illegal state: cannot execute invoke calls when in state ${this.state}`
        );
      }
    }).then((result) => {
      return result as Uint8Array;
    });
  }

  async inBackground<T>(call: () => Promise<T>): Promise<void> {
    this.inBackgroundCallFlag = true;
    call();
    this.inBackgroundCallFlag = false;
  }

  async sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    console.debug("Service used side effect");
    this.incrementJournalIndex();

    return new Promise((resolve, reject) => {
      this.addPromise(this.currentJournalIndex, resolve);

      const sideEffectOutput = fn().then((result) => {
        if (this.state === ExecutionState.PROCESSING) {
          const bytes = Buffer.from(JSON.stringify(result));
          this.connection.send(SIDE_EFFECT_ENTRY_MESSAGE_TYPE, bytes);
        } else {
          console.debug(
            "Ignoring side effect call from user. We are in replay mode. This will be fulfilled by the next journal entry."
          );
        }
        return result;
      });
      return sideEffectOutput;
    });
  }

  async sleep(millis: number): Promise<void> {
    console.debug("Service called sleep");

    this.incrementJournalIndex();

    if (this.state === ExecutionState.PROCESSING) {
      console.debug("Forward the SleepEntryMessage to the runtime");
      // Forward to runtime
      this.connection.send(
        SLEEP_ENTRY_MESSAGE_TYPE,
        SleepEntryMessage.create({ wakeUpTime: Date.now() + millis })
      );
    } else {
      console.debug(
        "In replay mode: Sleep message will not be forwarded to the runtime. This will be fulfilled by the next replayed journal entry."
      );
    }
  }

  // Called for every incoming message from the runtime: start messages, input messages and replay messages.
  onIncomingMessage(
    message_type: bigint,
    message: any,
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
        const m = message as CompletionMessage;
        console.debug("Received completion message: " + JSON.stringify(m));

        if (this.state === ExecutionState.REPLAYING) {
          throw new Error(
            "Illegal state: received completion message but still in replay state."
          );
        }

        this.resolvePromise(m.entryIndex, m.value);
        break;
      }
      case POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE: {
        const m = message as PollInputStreamEntryMessage;
        console.debug("Received input message: " + JSON.stringify(m));

        this.method.invoke(this, m.value).then(
          (value) => this.onCallSuccess(value),
          (failure) => this.onCallFailure(failure)
        );

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
        const m = message as SleepEntryMessage;
        console.debug("Received SleepEntryMessage: " + JSON.stringify(m));
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
        this.handleSideEffectMessage(message);
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

  handleGetStateMessage(m: GetStateEntryMessage): void {
    console.debug(
      "Received completed GetStateEntryMessage from runtime: " +
        JSON.stringify(m)
    );

    this.checkIfInReplay();

    if (m.value != undefined) {
      console.debug("Resolving state to " + m.value.toString());
      this.resolvePromise(this.currentJournalIndex, m.value as Buffer);
    } else {
      console.debug("Empty value");
      this.resolvePromise(this.currentJournalIndex, null);
    }
  }

  handleInvokeEntryMessage(m: InvokeEntryMessage) {
    console.debug("Received InvokeEntryMessage: " + JSON.stringify(m));

    this.checkIfInReplay();

    if (m.value != undefined) {
      console.debug("Resolving invoke message");
      this.resolvePromise(this.replayIndex, m.value);
    } else {
      console.debug("Empty value");
      this.resolvePromise(this.replayIndex, null);
    }
  }

  handleSideEffectMessage(m: Buffer) {
    console.debug("Received SideEffectMessage: " + JSON.parse(m.toString()));

    this.checkIfInReplay();
    this.resolvePromise(this.replayIndex, JSON.parse(m.toString()));
  }

  handleAwakeableMessage(m: AwakeableEntryMessage) {
    console.debug("Received AwakeableEntryMessage: " + m.toString());

    this.checkIfInReplay();
    // We don't need to be in
    if (m.value != undefined) {
      console.debug("Resolving state to " + m.value.toString());
      this.resolvePromise(this.replayIndex, m.value as Buffer);
    } else {
      // TODO
      console.error("Awakeable message contained failure: " + m.failure);
    }
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

  addPromise(journalIndex: number, resolve: (value: any) => void) {
    // If we are replaying, the completion may have arrived before the user code got there.
    // Otherwise add to map.
    if (
      this.state === ExecutionState.REPLAYING &&
      this.outOfOrderReplayMessages.has(journalIndex)
    ) {
      // Resolving promise
      resolve(this.outOfOrderReplayMessages.get(journalIndex));
    } else {
      this.pendingPromises.set(journalIndex, resolve);
    }
  }

  resolvePromise<T>(journalIndex: number, value: T) {
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
    resolveFct(value);
    this.pendingPromises.delete(journalIndex);
  }

  onCallSuccess(result: Uint8Array) {
    console.debug("Call successfully completed");
    this.connection.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({ value: Buffer.from(result) })
    );
    this.connection.end();
  }

  onCallFailure(failure: any) {
    console.debug("Call failed: " + failure);
    // TODO parse error codes and messages
    this.connection.send(
      OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
      OutputStreamEntryMessage.create({
        failure: { code: 1, message: failure },
      })
    );
    this.connection.end();
  }

  onClose() {
    // done.
    console.log(`DEBUG connection ${this.connection} has been closed.`);
  }
}
