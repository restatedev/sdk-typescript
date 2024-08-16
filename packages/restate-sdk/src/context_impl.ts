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

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  CombineablePromise,
  ContextDate,
  DurablePromise,
  GenericCall,
  GenericSend,
  ObjectContext,
  Rand,
  Request,
  RunAction,
  RunOptions,
  SendOptions,
  WorkflowContext,
} from "./context.js";
import type { StateMachine } from "./state_machine.js";
import type { GetStateKeysEntryMessage_StateKeys } from "./generated/proto/protocol_pb.js";
import {
  AwakeableEntryMessage,
  OneWayCallEntryMessage,
  CompleteAwakeableEntryMessage,
  Empty,
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  CallEntryMessage,
  RunEntryMessage,
  SleepEntryMessage,
  GetPromiseEntryMessage,
  PeekPromiseEntryMessage,
  CompletePromiseEntryMessage,
} from "./generated/proto/protocol_pb.js";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_IDENTIFIER_PREFIX,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  GET_PROMISE_MESSAGE_TYPE,
  PEEK_PROMISE_MESSAGE_TYPE,
  COMPLETE_PROMISE_MESSAGE_TYPE,
} from "./types/protocol.js";
import {
  RetryableError,
  TerminalError,
  ensureError,
  TimeoutError,
  INTERNAL_ERROR_CODE,
  UNKNOWN_ERROR_CODE,
  errorToFailure,
} from "./types/errors.js";
import type { PartialMessage } from "@bufbuild/protobuf";
import { protoInt64 } from "@bufbuild/protobuf";
import {
  HandlerKind,
  makeRpcCallProxy,
  makeRpcSendProxy,
  defaultSerde,
} from "./types/rpc.js";
import type { Client, SendClient } from "./types/rpc.js";
import type {
  Service,
  ServiceDefinitionFrom,
  VirtualObjectDefinitionFrom,
  VirtualObject,
  WorkflowDefinitionFrom,
  Workflow,
  Serde,
} from "@restatedev/restate-sdk-core";
import { serde } from "@restatedev/restate-sdk-core";
import { RandImpl } from "./utils/rand.js";
import { newJournalEntryPromiseId } from "./promise_combinator_tracker.js";
import type { WrappedPromise } from "./utils/promises.js";
import { Buffer } from "node:buffer";

export type InternalCombineablePromise<T> = CombineablePromise<T> & {
  journalIndex: number;
};

export class ContextImpl implements ObjectContext, WorkflowContext {
  // This is used to guard users against calling ctx.sideEffect without awaiting it.
  // See https://github.com/restatedev/sdk-typescript/issues/197 for more details.
  private executingRun = false;
  private readonly invocationRequest: Request;
  public readonly rand: Rand;

  public readonly date: ContextDate = {
    now: (): Promise<number> => {
      return this.run(() => Date.now());
    },

    toJSON: (): Promise<string> => {
      return this.run(() => new Date().toJSON());
    },
  };

  constructor(
    id: Uint8Array,
    public readonly console: Console,
    public readonly handlerKind: HandlerKind,
    public readonly keyedContextKey: string | undefined,
    invocationValue: Uint8Array,
    invocationHeaders: ReadonlyMap<string, string>,
    attemptHeaders: ReadonlyMap<string, string | string[] | undefined>,
    extraArgs: unknown[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly stateMachine: StateMachine
  ) {
    this.invocationRequest = {
      id,
      headers: invocationHeaders,
      attemptHeaders,
      body: invocationValue,
      extraArgs,
    };
    this.rand = new RandImpl(id, this.checkState.bind(this));
  }

  public promise<T = void>(name: string): DurablePromise<T> {
    return new DurablePromiseImpl(this, name);
  }

  public get key(): string {
    switch (this.handlerKind) {
      case HandlerKind.EXCLUSIVE:
      case HandlerKind.SHARED:
      case HandlerKind.WORKFLOW: {
        if (this.keyedContextKey === undefined) {
          throw new TerminalError("unexpected missing key");
        }
        return this.keyedContextKey;
      }
      case HandlerKind.SERVICE:
        throw new TerminalError("unexpected missing key");
      default:
        throw new TerminalError("unknown handler type");
    }
  }

  public request(): Request {
    return this.invocationRequest;
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  public get<T>(name: string, serde?: Serde<T>): Promise<T | null> {
    // Check if this is a valid action
    this.checkState("get state");

    // Create the message and let the state machine process it
    const msg = new GetStateEntryMessage({
      key: new TextEncoder().encode(name),
    });
    const completed = this.stateMachine.localStateStore.tryCompleteGet(
      name,
      msg
    );

    const getState = async (): Promise<T | null> => {
      const result = await this.stateMachine.handleUserCodeMessage(
        GET_STATE_ENTRY_MESSAGE_TYPE,
        msg,
        completed
      );

      // If the GetState message did not have a value or empty,
      // then we went to the runtime to get the value.
      // When we get the response, we set it in the localStateStore,
      // to answer subsequent requests
      if (!completed) {
        this.stateMachine.localStateStore.add(
          name,
          result as Uint8Array | Empty
        );
      }

      if (!(result instanceof Uint8Array)) {
        return null;
      }

      return (serde ?? defaultSerde()).deserialize(result);
    };
    return getState();
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  public stateKeys(): Promise<Array<string>> {
    // Check if this is a valid action
    this.checkState("state keys");

    // Create the message and let the state machine process it
    const msg = new GetStateKeysEntryMessage({});
    const completed =
      this.stateMachine.localStateStore.tryCompletedGetStateKeys(msg);

    const getStateKeys = async (): Promise<Array<string>> => {
      const result = await this.stateMachine.handleUserCodeMessage(
        GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
        msg,
        completed
      );

      return (result as GetStateKeysEntryMessage_StateKeys).keys.map((b) =>
        new TextDecoder().decode(b)
      );
    };
    return getStateKeys();
  }

  public set<T>(name: string, value: T, serde?: Serde<T>): void {
    this.checkState("set state");
    const bytes = (serde ?? defaultSerde()).serialize(value);
    const msg = this.stateMachine.localStateStore.set(name, bytes);
    this.stateMachine
      .handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e as Error));
  }

  public clear(name: string): void {
    this.checkState("clear state");

    const msg = this.stateMachine.localStateStore.clear(name);
    this.stateMachine
      .handleUserCodeMessage(CLEAR_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e as Error));
  }

  public clearAll(): void {
    this.checkState("clear all state");

    const msg = this.stateMachine.localStateStore.clearAll();
    this.stateMachine
      .handleUserCodeMessage(CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e as Error));
  }

  // --- Calls, background calls, etc
  //
  public genericCall<REQ = Uint8Array, RES = Uint8Array>(
    call: GenericCall<REQ, RES>
  ): Promise<RES> {
    const requestSerde: Serde<REQ> =
      call.inputSerde ?? (serde.binary as Serde<REQ>);

    const responseSerde: Serde<RES> =
      call.outputSerde ?? (serde.binary as Serde<RES>);

    const parameter = requestSerde.serialize(call.parameter);
    const msg = new CallEntryMessage({
      serviceName: call.service,
      handlerName: call.method,
      parameter,
      key: call.key,
    });
    const rawRequest = this.stateMachine.handleUserCodeMessage(
      INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    ) as WrappedPromise<Uint8Array>;
    const decoded = rawRequest.transform((res: Uint8Array) =>
      responseSerde.deserialize(res)
    );
    return this.markCombineablePromise(decoded);
  }

  public genericSend<REQ = Uint8Array>(send: GenericSend<REQ>) {
    const requestSerde = send.inputSerde ?? (serde.binary as Serde<REQ>);
    const parameter = requestSerde.serialize(send.parameter);
    const actualDelay = send.delay || 0;
    const jsInvokeTime =
      actualDelay > 0 ? Date.now() + actualDelay : protoInt64.zero;
    const invokeTime = protoInt64.parse(jsInvokeTime);
    const msg = new OneWayCallEntryMessage({
      serviceName: send.service,
      handlerName: send.method,
      parameter,
      invokeTime,
      key: send.key,
    });
    this.stateMachine
      .handleUserCodeMessage(BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => {
        this.stateMachine.handleDanglingPromiseError(e as Error);
      });
  }

  serviceClient<D>({ name }: ServiceDefinitionFrom<D>): Client<Service<D>> {
    return makeRpcCallProxy((call) => this.genericCall(call), name);
  }

  objectClient<D>(
    { name }: VirtualObjectDefinitionFrom<D>,
    key: string
  ): Client<VirtualObject<D>> {
    return makeRpcCallProxy((call) => this.genericCall(call), name, key);
  }

  workflowClient<D>(
    { name }: WorkflowDefinitionFrom<D>,
    key: string
  ): Client<Workflow<D>> {
    return makeRpcCallProxy((call) => this.genericCall(call), name, key);
  }

  public serviceSendClient<D>(
    { name }: ServiceDefinitionFrom<D>,
    opts?: SendOptions
  ): SendClient<Service<D>> {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      name,
      undefined,
      opts?.delay
    );
  }

  public objectSendClient<D>(
    { name }: VirtualObjectDefinitionFrom<D>,
    key: string,
    opts?: SendOptions
  ): SendClient<VirtualObject<D>> {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      name,
      key,
      opts?.delay
    );
  }

  workflowSendClient<D>(
    { name }: WorkflowDefinitionFrom<D>,
    key: string,
    opts?: SendOptions
  ): SendClient<Workflow<D>> {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      name,
      key,
      opts?.delay
    );
  }

  // DON'T make this function async!!!
  // The reason is that we want the errors thrown by the initial checks to be propagated in the caller context,
  // and not in the promise context. To understand the semantic difference, make this function async and run the
  // UnawaitedSideEffectShouldFailSubsequentContextCall test.
  public run<T>(
    nameOrAction: string | RunAction<T>,
    actionSecondParameter?: RunAction<T>,
    options?: RunOptions<T>
  ): Promise<T> {
    this.checkState("run");

    const { name, action } = unpack(nameOrAction, actionSecondParameter);
    this.executingRun = true;

    const serde = options?.serde ?? defaultSerde();

    const executeRun = async () => {
      // in replay mode, we directly return the value from the log
      if (this.stateMachine.nextEntryWillBeReplayed()) {
        const emptyMsg = new RunEntryMessage({});
        return this.stateMachine
          .handleUserCodeMessage(SIDE_EFFECT_ENTRY_MESSAGE_TYPE, emptyMsg)
          .transform((result) => {
            if (!result || result instanceof Empty) {
              return undefined as T;
            }
            return serde.deserialize(result);
          });
      }

      let sideEffectResult: T;
      try {
        sideEffectResult = await action();
      } catch (e) {
        if (!(e instanceof TerminalError)) {
          ///non terminal errors are retirable.
          // we do not commit the error itself into the journal, but rather let restate know about this
          // so that restate can retry this invocation later.
          // Before we can propagate this error to the user, we must let the state machine know that this attempt
          // is finished with an error, and it should not append anything else to the journal from now on.
          const error = ensureError(e);
          const additionalContext = {
            relatedEntryName: name,
            relatedEntryType: SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          };
          await this.stateMachine.sendErrorAndFinish(error, additionalContext);
          throw e;
        }
        // we commit a terminal error from the side effect to the journal, and re-throw it into
        // the function. that way, any catching by the user and reacting to it will be
        // deterministic on replay
        const error = ensureError(e);
        const failure = errorToFailure(error);
        const sideEffectMsg = new RunEntryMessage({
          name,
          result: { case: "failure", value: failure },
        });

        // this may throw an error from the SDK/runtime/connection side, in case the
        // failure message cannot be committed to the journal. That error would then
        // be returned from this function (replace the original error)
        // that is acceptable, because in such a situation (failure to append to journal),
        // the state machine closes anyways and no further operations will succeed and the
        // the execution aborts
        await this.stateMachine.handleUserCodeMessage(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          sideEffectMsg,
          false,
          true
        );

        throw e;
      }

      // we have this code outside the above try/catch block, to ensure that any error arising
      // from here is not incorrectly attributed to the side-effect
      const sideEffectMsg =
        sideEffectResult !== undefined
          ? new RunEntryMessage({
              name,
              result: {
                case: "value",
                value: serde.serialize(sideEffectResult),
              },
            })
          : new RunEntryMessage({
              name,
            });

      // if an error arises from committing the side effect result, then this error will
      // be thrown here (reject the returned promise) and the function will see that error,
      // even if the side-effect function completed correctly
      // that is acceptable, because in such a situation (failure to append to journal),
      // the state machine closes anyways and reports an execution failure, meaning no further
      // operations will succeed and the the execution will be retried.
      // If the side-effect result did in fact not make it to the journal, then the side-effect
      // re-executes, and if it made it to the journal after all (error happend inly during
      // ack-back), then retries will use the journaled result.
      // So all good in any case, due to the beauty of "the runtime log is the ground thruth" approach.
      await this.stateMachine.handleUserCodeMessage(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        sideEffectMsg,
        false,
        true
      );

      return sideEffectResult;
    };

    return executeRun().finally(() => {
      this.executingRun = false;
    });
  }

  public sleep(millis: number): CombineablePromise<void> {
    this.checkState("sleep");
    return this.markCombineablePromise(this.sleepInternal(millis));
  }

  private sleepInternal(millis: number): WrappedPromise<void> {
    return this.stateMachine.handleUserCodeMessage(
      SLEEP_ENTRY_MESSAGE_TYPE,
      new SleepEntryMessage({
        wakeUpTime: protoInt64.parse(Date.now() + millis),
      })
    ) as WrappedPromise<void>;
  }

  // -- Awakeables

  public awakeable<T>(serde?: Serde<T>): {
    id: string;
    promise: CombineablePromise<T>;
  } {
    this.checkState("awakeable");

    const msg = new AwakeableEntryMessage();
    const promise = this.stateMachine
      .handleUserCodeMessage(AWAKEABLE_ENTRY_MESSAGE_TYPE, msg)
      .transform((result: Uint8Array | Empty | void) => {
        if (!(result instanceof Uint8Array)) {
          // This should either be a filled buffer or an empty buffer but never anything else.
          throw RetryableError.internal(
            "Awakeable was not resolved with a buffer payload"
          );
        }
        if (!serde) {
          return defaultSerde<T>().deserialize(result);
        }
        if (result.length == 0) {
          return undefined as T;
        }
        return serde.deserialize(result);
      });

    // This needs to be done after handling the message in the state machine
    // otherwise the index is not yet incremented.

    const encodedEntryIndex = Buffer.alloc(4 /* Size of u32 */);
    encodedEntryIndex.writeUInt32BE(
      this.stateMachine.getUserCodeJournalIndex()
    );

    return {
      id:
        AWAKEABLE_IDENTIFIER_PREFIX +
        Buffer.concat([this.request().id, encodedEntryIndex]).toString(
          "base64url"
        ),
      promise: this.markCombineablePromise(promise),
    };
  }

  public resolveAwakeable<T>(id: string, payload?: T, serde?: Serde<T>): void {
    // We coerce undefined to null as null can be stringified by JSON.stringify
    let value: Uint8Array;

    if (serde) {
      value =
        payload == undefined ? new Uint8Array() : serde.serialize(payload);
    } else {
      value =
        payload != undefined
          ? defaultSerde().serialize(payload)
          : defaultSerde().serialize(null);
    }

    this.checkState("resolveAwakeable");
    this.completeAwakeable(id, {
      result: {
        case: "value",
        value,
      },
    });
  }

  public rejectAwakeable(id: string, reason: string): void {
    this.checkState("rejectAwakeable");
    this.completeAwakeable(id, {
      result: {
        case: "failure",
        value: { code: UNKNOWN_ERROR_CODE, message: reason },
      },
    });
  }

  private completeAwakeable(
    id: string,
    base: PartialMessage<CompleteAwakeableEntryMessage>
  ): void {
    base.id = id;
    this.stateMachine
      .handleUserCodeMessage(
        COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
        new CompleteAwakeableEntryMessage(base)
      )
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e as Error));
  }

  // Used by static methods of CombineablePromise
  public static createCombinator<
    T extends readonly CombineablePromise<unknown>[]
  >(
    combinatorConstructor: (
      promises: PromiseLike<unknown>[]
    ) => Promise<unknown>,
    promises: T
  ): WrappedPromise<unknown> {
    const self = extractContext(promises[0]);
    if (!self) {
      throw RetryableError.internal("Not a combinable promise");
    }
    const outPromises = [];
    for (const promise of promises) {
      if (extractContext(promise) !== self) {
        throw RetryableError.internal(
          "You're mixing up CombineablePromises from different RestateContext. This is not supported."
        );
      }
      const index = (promise as InternalCombineablePromise<unknown>)
        .journalIndex;
      outPromises.push({
        id: newJournalEntryPromiseId(index),
        promise: promise,
      });
    }

    return self.stateMachine.createCombinator(
      combinatorConstructor,
      outPromises
    );
  }

  // -- Various private methods

  private checkNotExecutingRun(callType: string) {
    if (this.executingRun) {
      throw new TerminalError(
        `Invoked a RestateContext method (${callType}) while a run() is still executing.
          Make sure you await the ctx.run() call before using any other RestateContext method.`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
  }

  private checkState(callType: string): void {
    this.checkNotExecutingRun(callType);
  }

  markCombineablePromise<T>(
    p: WrappedPromise<T>
  ): InternalCombineablePromise<T> {
    const journalIndex = this.stateMachine.getUserCodeJournalIndex();
    const orTimeout = (millis: number): Promise<T> => {
      const sleepPromise: Promise<T> = this.sleepInternal(millis).transform(
        () => {
          throw new TimeoutError();
        }
      );
      const sleepPromiseIndex = this.stateMachine.getUserCodeJournalIndex();

      return this.stateMachine.createCombinator(Promise.race.bind(Promise), [
        {
          id: newJournalEntryPromiseId(journalIndex),
          promise: p,
        },
        {
          id: newJournalEntryPromiseId(sleepPromiseIndex),
          promise: sleepPromise,
        },
      ]) as Promise<T>;
    };

    defineProperty(p, RESTATE_CTX_SYMBOL, this);
    defineProperty(p, "journalIndex", journalIndex);
    defineProperty(p, "orTimeout", orTimeout.bind(this));

    return p;
  }
}

// wraps defineProperty such that it informs tsc of the correct type of its output
function defineProperty<Obj extends object, Key extends PropertyKey, T>(
  obj: Obj,
  prop: Key,
  value: T
): asserts obj is Obj & Readonly<Record<Key, T>> {
  Object.defineProperty(obj, prop, { value });
}

function unpack<T>(
  a: string | RunAction<T>,
  b?: RunAction<T>
): { name?: string; action: RunAction<T> } {
  if (typeof a == "string") {
    if (typeof b !== "function") {
      throw new TypeError("");
    }
    return { name: a, action: b };
  }
  if (typeof a !== "function") {
    throw new TypeError("unexpected type at the first parameter");
  }
  if (b) {
    throw new TypeError("unexpected a function as a second parameter.");
  }
  return { action: a };
}

const RESTATE_CTX_SYMBOL = Symbol("restateContext");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContext(n: any): ContextImpl | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return n[RESTATE_CTX_SYMBOL] as ContextImpl | undefined;
}

class DurablePromiseImpl<T> implements DurablePromise<T> {
  private readonly serde: Serde<T>;

  constructor(
    private readonly ctx: ContextImpl,
    private readonly name: string,
    _serde?: Serde<T>
  ) {
    this.serde = _serde ?? defaultSerde();
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined
  ): Promise<TResult1 | TResult2> {
    return this.get().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | null
      | undefined
  ): Promise<T | TResult> {
    return this.get().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<T> {
    return this.get().finally(onfinally);
  }

  [Symbol.toStringTag] = "DurablePromise";

  get(): InternalCombineablePromise<T> {
    const msg = new GetPromiseEntryMessage({
      key: this.name,
    });

    return this.ctx.markCombineablePromise(
      this.ctx.stateMachine
        .handleUserCodeMessage(GET_PROMISE_MESSAGE_TYPE, msg)
        .transform((v) => {
          if (!v) {
            return undefined as T;
          }
          if (v instanceof Empty) {
            return undefined as T;
          }
          return this.serde.deserialize(v);
        })
    );
  }

  peek(): Promise<T | undefined> {
    const msg = new PeekPromiseEntryMessage({
      key: this.name,
    });

    return this.ctx.stateMachine
      .handleUserCodeMessage(PEEK_PROMISE_MESSAGE_TYPE, msg)
      .transform((v): any => {
        if (!v || v instanceof Empty) {
          return undefined as T;
        }
        return this.serde.deserialize(v);
      });
  }

  resolve(value?: T | undefined): Promise<void> {
    const buffer =
      value != undefined ? this.serde.serialize(value) : new Uint8Array();
    const msg = new CompletePromiseEntryMessage({
      key: this.name,
      completion: {
        case: "completionValue",
        value: buffer,
      },
    });

    return this.ctx.stateMachine.handleUserCodeMessage(
      COMPLETE_PROMISE_MESSAGE_TYPE,
      msg
    ) as Promise<void>;
  }

  reject(errorMsg: string): Promise<void> {
    const msg = new CompletePromiseEntryMessage({
      key: this.name,
      completion: {
        case: "completionFailure",
        value: {
          message: errorMsg,
        },
      },
    });

    return this.ctx.stateMachine.handleUserCodeMessage(
      COMPLETE_PROMISE_MESSAGE_TYPE,
      msg
    ) as Promise<void>;
  }
}
