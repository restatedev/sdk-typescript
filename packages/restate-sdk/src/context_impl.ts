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
  ObjectContext,
  Rand,
  Request,
  RunAction,
  SendOptions,
  WorkflowContext,
} from "./context";
import type { StateMachine } from "./state_machine";
import type { GetStateKeysEntryMessage_StateKeys } from "./generated/proto/protocol_pb";
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
} from "./generated/proto/protocol_pb";
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
} from "./types/protocol";
import {
  RetryableError,
  TerminalError,
  ensureError,
  TimeoutError,
  INTERNAL_ERROR_CODE,
  UNKNOWN_ERROR_CODE,
  errorToFailure,
} from "./types/errors";
import { jsonSerialize, jsonDeserialize } from "./utils/utils";
import { type PartialMessage, protoInt64 } from "@bufbuild/protobuf";
import { type Client, HandlerKind, type SendClient } from "./types/rpc";
import type {
  Service,
  ServiceDefinitionFrom,
  VirtualObjectDefinitionFrom,
  VirtualObject,
  WorkflowDefinitionFrom,
  Workflow,
} from "@restatedev/restate-sdk-core";
import { RandImpl } from "./utils/rand";
import { newJournalEntryPromiseId } from "./promise_combinator_tracker";
import type { WrappedPromise } from "./utils/promises";
import { Buffer } from "node:buffer";
import { deserializeJson, serializeJson } from "./utils/serde";

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
    id: Buffer,
    public readonly console: Console,
    public readonly handlerKind: HandlerKind,
    public readonly keyedContextKey: string | undefined,
    invocationValue: Uint8Array,
    invocationHeaders: ReadonlyMap<string, string>,
    attemptHeaders: ReadonlyMap<string, string | string[] | undefined>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly stateMachine: StateMachine
  ) {
    this.invocationRequest = {
      id,
      headers: invocationHeaders,
      attemptHeaders,
      body: invocationValue,
    };
    this.rand = new RandImpl(id, this.checkState.bind(this));
  }

  workflowClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): Client<Workflow<D>> {
    const { name } = opts;
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            return this.invoke(name, route, requestBytes, key);
          };
        },
      }
    );

    return clientProxy as Client<Workflow<D>>;
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
  public get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    this.checkState("get state");

    // Create the message and let the state machine process it
    const msg = new GetStateEntryMessage({ key: Buffer.from(name) });
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
        this.stateMachine.localStateStore.add(name, result as Buffer | Empty);
      }

      if (!(result instanceof Buffer)) {
        return null;
      }

      return jsonDeserialize(result.toString());
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
        b.toString()
      );
    };
    return getStateKeys();
  }

  public set<T>(name: string, value: T): void {
    this.checkState("set state");
    const msg = this.stateMachine.localStateStore.set(name, value);
    this.stateMachine
      .handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
  }

  public clear(name: string): void {
    this.checkState("clear state");

    const msg = this.stateMachine.localStateStore.clear(name);
    this.stateMachine
      .handleUserCodeMessage(CLEAR_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
  }

  public clearAll(): void {
    this.checkState("clear all state");

    const msg = this.stateMachine.localStateStore.clearAll();
    this.stateMachine
      .handleUserCodeMessage(CLEAR_ALL_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
  }

  // --- Calls, background calls, etc

  // DON'T make this function async!!! see sideEffect comment for details.
  private invoke(
    service: string,
    method: string,
    data: Uint8Array,
    key?: string
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  ): InternalCombineablePromise<any> {
    this.checkState("invoke");

    const msg = new CallEntryMessage({
      serviceName: service,
      handlerName: method,
      parameter: data,
      key,
    });
    return this.markCombineablePromise(
      this.stateMachine
        .handleUserCodeMessage(INVOKE_ENTRY_MESSAGE_TYPE, msg)
        .transform((v) => deserializeJson(v as Uint8Array))
    );
  }

  private async invokeOneWay(
    service: string,
    method: string,
    data: Uint8Array,
    delay?: number,
    key?: string
  ): Promise<Uint8Array> {
    const actualDelay = delay || 0;
    const invokeTime =
      actualDelay > 0 ? Date.now() + actualDelay : protoInt64.zero;
    const msg = new OneWayCallEntryMessage({
      serviceName: service,
      handlerName: method,
      parameter: data,
      invokeTime: protoInt64.parse(invokeTime),
      key,
    });

    await this.stateMachine.handleUserCodeMessage(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    );
    return new Uint8Array();
  }

  serviceClient<D>({ name }: ServiceDefinitionFrom<D>): Client<Service<D>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            return this.invoke(name, route, requestBytes);
          };
        },
      }
    );

    return clientProxy as Client<Service<D>>;
  }

  objectClient<D>(
    { name }: VirtualObjectDefinitionFrom<D>,
    key: string
  ): Client<VirtualObject<D>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            return this.invoke(name, route, requestBytes, key);
          };
        },
      }
    );

    return clientProxy as Client<VirtualObject<D>>;
  }

  public serviceSendClient<D>(
    service: ServiceDefinitionFrom<D>,
    opts?: SendOptions
  ): SendClient<Service<D>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            this.invokeOneWay(
              service.name,
              route,
              requestBytes,
              opts?.delay
            ).catch((e) => {
              this.stateMachine.handleDanglingPromiseError(e);
            });
          };
        },
      }
    );

    return clientProxy as SendClient<Service<D>>;
  }

  public objectSendClient<D>(
    obj: VirtualObjectDefinitionFrom<D>,
    key: string,
    opts?: SendOptions
  ): SendClient<VirtualObject<D>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            this.invokeOneWay(
              obj.name,
              route,
              requestBytes,
              opts?.delay,
              key
            ).catch((e) => {
              this.stateMachine.handleDanglingPromiseError(e);
            });
          };
        },
      }
    );

    return clientProxy as SendClient<VirtualObject<D>>;
  }

  workflowSendClient<D>(
    def: WorkflowDefinitionFrom<D>,
    key: string,
    opts?: SendOptions
  ): SendClient<Workflow<D>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            this.invokeOneWay(
              def.name,
              route,
              requestBytes,
              opts?.delay,
              key
            ).catch((e) => {
              this.stateMachine.handleDanglingPromiseError(e);
            });
          };
        },
      }
    );

    return clientProxy as SendClient<Workflow<D>>;
  }

  // DON'T make this function async!!!
  // The reason is that we want the errors thrown by the initial checks to be propagated in the caller context,
  // and not in the promise context. To understand the semantic difference, make this function async and run the
  // UnawaitedSideEffectShouldFailSubsequentContextCall test.
  public run<T>(
    nameOrAction: string | RunAction<T>,
    actionSecondParameter?: RunAction<T>
  ): Promise<T> {
    this.checkState("run");

    const { name, action } = unpack(nameOrAction, actionSecondParameter);
    this.executingRun = true;

    const executeRun = async () => {
      // in replay mode, we directly return the value from the log
      if (this.stateMachine.nextEntryWillBeReplayed()) {
        const emptyMsg = new RunEntryMessage({});
        return this.stateMachine.handleUserCodeMessage<T>(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          emptyMsg
        ) as Promise<T>;
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
        await this.stateMachine.handleUserCodeMessage<T>(
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
                value: Buffer.from(jsonSerialize(sideEffectResult)),
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
      await this.stateMachine.handleUserCodeMessage<T>(
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
    return this.stateMachine.handleUserCodeMessage<void>(
      SLEEP_ENTRY_MESSAGE_TYPE,
      new SleepEntryMessage({
        wakeUpTime: protoInt64.parse(Date.now() + millis),
      })
    );
  }

  // -- Awakeables

  public awakeable<T>(): { id: string; promise: CombineablePromise<T> } {
    this.checkState("awakeable");

    const msg = new AwakeableEntryMessage();
    const promise = this.stateMachine
      .handleUserCodeMessage<Buffer>(AWAKEABLE_ENTRY_MESSAGE_TYPE, msg)
      .transform((result: Buffer | void) => {
        if (!(result instanceof Buffer)) {
          // This should either be a filled buffer or an empty buffer but never anything else.
          throw RetryableError.internal(
            "Awakeable was not resolved with a buffer payload"
          );
        }

        return JSON.parse(result.toString()) as T;
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

  public resolveAwakeable<T>(id: string, payload?: T): void {
    // We coerce undefined to null as null can be stringified by JSON.stringify
    const payloadToWrite = payload === undefined ? null : payload;

    this.checkState("resolveAwakeable");
    this.completeAwakeable(id, {
      result: {
        case: "value",
        value: Buffer.from(JSON.stringify(payloadToWrite)),
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
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
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
  return n[RESTATE_CTX_SYMBOL];
}

class DurablePromiseImpl<T> implements DurablePromise<T> {
  constructor(
    private readonly ctx: ContextImpl,
    private readonly name: string
  ) {}

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
        .transform((v) => deserializeJson(v as Uint8Array))
    );
  }

  peek(): Promise<T | undefined> {
    const msg = new PeekPromiseEntryMessage({
      key: this.name,
    });

    return this.ctx.stateMachine
      .handleUserCodeMessage(PEEK_PROMISE_MESSAGE_TYPE, msg)
      .transform((v) =>
        v instanceof Empty ? undefined : deserializeJson(v as Uint8Array)
      );
  }

  resolve(value?: T | undefined): Promise<void> {
    const msg = new CompletePromiseEntryMessage({
      key: this.name,
      completion: {
        case: "completionValue",
        value: serializeJson(value),
      },
    });

    return this.ctx.stateMachine.handleUserCodeMessage(
      COMPLETE_PROMISE_MESSAGE_TYPE,
      msg
    );
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
    );
  }
}
