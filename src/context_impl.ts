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

import { CombineablePromise, ObjectContext, Rand, Request } from "./context";
import { StateMachine } from "./state_machine";
import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  CompleteAwakeableEntryMessage,
  DeepPartial,
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  GetStateKeysEntryMessage_StateKeys,
  InvokeEntryMessage,
  SleepEntryMessage,
} from "./generated/proto/protocol";
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
} from "./types/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { AsyncLocalStorage } from "async_hooks";
import {
  RestateErrorCodes,
  RestateError,
  RetryableError,
  TerminalError,
  ensureError,
  errorToFailureWithTerminal,
  TimeoutError,
  INTERNAL_ERROR_CODE,
  UNKNOWN_ERROR_CODE,
} from "./types/errors";
import { jsonSerialize, jsonDeserialize } from "./utils/utils";
import { Empty } from "./generated/google/protobuf/empty";
import {
  DEFAULT_INFINITE_EXPONENTIAL_BACKOFF,
  DEFAULT_INITIAL_DELAY_MS,
  EXPONENTIAL_BACKOFF,
  RetrySettings,
} from "./utils/public_utils";
import { Client, SendClient, ServiceDefintion } from "./types/rpc";
import { RandImpl } from "./utils/rand";
import { newJournalEntryPromiseId } from "./promise_combinator_tracker";
import { WrappedPromise } from "./utils/promises";
import { Buffer } from "node:buffer";
import { deserializeJson, serializeJson } from "./utils/serde";

export enum CallContexType {
  None,
  SideEffect,
  OneWayCall,
}

export interface CallContext {
  type: CallContexType;
  delay?: number;
}

export type InternalCombineablePromise<T> = CombineablePromise<T> &
  WrappedPromise<T> & {
    journalIndex: number;
  };

export class ContextImpl implements ObjectContext {
  // here, we capture the context information for actions on the Restate context that
  // are executed within other actions, such as
  // ctx.oneWayCall( () => client.foo(bar) );
  // we also use this information to ensure we check that only allowed operations are
  // used. Within side-effects, no operations are allowed on the RestateContext.
  // For example, this is illegal: 'ctx.sideEffect(() => {await ctx.get("my-state")})'
  static callContext = new AsyncLocalStorage<CallContext>();

  // This is used to guard users against calling ctx.sideEffect without awaiting it.
  // See https://github.com/restatedev/sdk-typescript/issues/197 for more details.
  private executingSideEffect = false;
  private readonly invocationRequest: Request;

  constructor(
    id: Buffer,
    public readonly console: Console,
    public readonly keyedContext: boolean,
    public readonly keyedContextKey: string | undefined,
    invocationValue: Uint8Array,
    invocationHeaders: ReadonlyMap<string, string>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly stateMachine: StateMachine,
    public readonly rand: Rand = new RandImpl(id)
  ) {
    this.invocationRequest = {
      id,
      headers: invocationHeaders,
      body: invocationValue,
    };
  }

  public key(): string {
    if (!this.keyedContextKey) {
      throw new TerminalError("unexpected missing key");
    }
    return this.keyedContextKey;
  }

  public request(): Request {
    return this.invocationRequest;
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  public get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    this.checkState("get state");
    this.checkStateOperation("get state");

    // Create the message and let the state machine process it
    const msg = GetStateEntryMessage.create({ key: Buffer.from(name) });
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
    const msg = GetStateKeysEntryMessage.create({});
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
    this.checkStateOperation("set state");
    const msg = this.stateMachine.localStateStore.set(name, value);
    this.stateMachine
      .handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg)
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
  }

  public clear(name: string): void {
    this.checkState("clear state");
    this.checkStateOperation("clear state");

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
  ): InternalCombineablePromise<Uint8Array> {
    this.checkState("invoke");

    const msg = InvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
      key,
    });
    return this.markCombineablePromise(
      this.stateMachine
        .handleUserCodeMessage(INVOKE_ENTRY_MESSAGE_TYPE, msg)
        .transform((v) => v as Uint8Array)
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
    const invokeTime = actualDelay > 0 ? Date.now() + actualDelay : undefined;
    const msg = BackgroundInvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
      invokeTime: invokeTime,
      key,
    });

    await this.stateMachine.handleUserCodeMessage(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    );
    return new Uint8Array();
  }

  service<P extends string, M>({ path }: ServiceDefintion<P, M>): Client<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            return this.invoke(path, route, requestBytes).transform(
              (responseBytes) => deserializeJson(responseBytes)
            );
          };
        },
      }
    );

    return clientProxy as Client<M>;
  }

  object<P extends string, M>(
    { path }: ServiceDefintion<P, M>,
    key: string
  ): Client<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            return this.invoke(path, route, requestBytes, key).transform(
              (responseBytes) => deserializeJson(responseBytes)
            );
          };
        },
      }
    );

    return clientProxy as Client<M>;
  }

  public serviceSend<P extends string, M>(
    options: ServiceDefintion<P, M>
  ): SendClient<M> {
    return this.serviceSendDelayed(options, 0);
  }

  public serviceSendDelayed<P extends string, M>(
    { path }: ServiceDefintion<P, M>,
    delayMillis: number
  ): SendClient<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            this.invokeOneWay(path, route, requestBytes, delayMillis).catch(
              (e) => {
                this.stateMachine.handleDanglingPromiseError(e);
              }
            );
          };
        },
      }
    );

    return clientProxy as SendClient<M>;
  }

  public objectSend<P extends string, M>(
    options: ServiceDefintion<P, M>,
    key: string
  ): SendClient<M> {
    return this.objectSendDelayed(options, 0, key);
  }

  public objectSendDelayed<P extends string, M>(
    { path }: ServiceDefintion<P, M>,
    delayMillis: number,
    key: string
  ): SendClient<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const requestBytes = serializeJson(args.shift());
            this.invokeOneWay(
              path,
              route,
              requestBytes,
              delayMillis,
              key
            ).catch((e) => {
              this.stateMachine.handleDanglingPromiseError(e);
            });
          };
        },
      }
    );

    return clientProxy as SendClient<M>;
  }

  // DON'T make this function async!!!
  // The reason is that we want the erros thrown by the initial checks to be propagated in the caller context,
  // and not in the promise context. To understand the semantic difference, make this function async and run the
  // UnawaitedSideEffectShouldFailSubsequentContextCall test.
  public sideEffect<T>(
    fn: () => Promise<T>,
    retryPolicy: RetrySettings = DEFAULT_INFINITE_EXPONENTIAL_BACKOFF
  ): Promise<T> {
    if (this.isInSideEffect()) {
      throw new TerminalError(
        "You cannot do sideEffect calls from within a side effect.",
        { errorCode: INTERNAL_ERROR_CODE }
      );
    } else if (this.isInOneWayCall()) {
      throw new TerminalError(
        "Cannot do a side effect from within ctx.oneWayCall(...). " +
          "Context method ctx.oneWayCall() can only be used to invoke other services unidirectionally. " +
          "e.g. ctx.oneWayCall(() => client.greet(my_request))",
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
    this.checkNotExecutingSideEffect();
    this.executingSideEffect = true;

    const executeAndLogSideEffect = async () => {
      // in replay mode, we directly return the value from the log
      if (this.stateMachine.nextEntryWillBeReplayed()) {
        const emptyMsg = SideEffectEntryMessage.create({});
        return this.stateMachine.handleUserCodeMessage<T>(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          emptyMsg
        ) as Promise<T>;
      }

      let sideEffectResult: T;
      try {
        sideEffectResult = await ContextImpl.callContext.run(
          { type: CallContexType.SideEffect },
          fn
        );
      } catch (e) {
        // we commit any error from the side effet to thr journal, and re-throw it into
        // the function. that way, any catching by the user and reacting to it will be
        // deterministic on replay
        const error = ensureError(e);
        const failure = errorToFailureWithTerminal(error);
        const sideEffectMsg = SideEffectEntryMessage.create({
          failure: failure,
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
          undefined,
          true
        );

        throw e;
      }

      // we have this code outside the above try/catch block, to ensure that any error arising
      // from here is not incorrectly attributed to the side-effect
      const sideEffectMsg =
        sideEffectResult !== undefined
          ? SideEffectEntryMessage.create({
              value: Buffer.from(jsonSerialize(sideEffectResult)),
            })
          : SideEffectEntryMessage.create();

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
        undefined,
        true
      );

      return sideEffectResult;
    };

    const sleep = (millis: number) => this.sleepInternal(millis);
    return executeWithRetries(
      this.console,
      retryPolicy,
      executeAndLogSideEffect,
      sleep
    ).finally(() => {
      this.executingSideEffect = false;
    });
  }

  public sleep(millis: number): CombineablePromise<void> {
    this.checkState("sleep");
    return this.markCombineablePromise(this.sleepInternal(millis));
  }

  private sleepInternal(millis: number): WrappedPromise<void> {
    return this.stateMachine.handleUserCodeMessage<void>(
      SLEEP_ENTRY_MESSAGE_TYPE,
      SleepEntryMessage.create({ wakeUpTime: Date.now() + millis })
    );
  }

  // -- Awakeables

  public awakeable<T>(): { id: string; promise: CombineablePromise<T> } {
    this.checkState("awakeable");

    const msg = AwakeableEntryMessage.create();
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
      value: Buffer.from(JSON.stringify(payloadToWrite)),
    });
  }

  public rejectAwakeable(id: string, reason: string): void {
    this.checkState("rejectAwakeable");
    this.completeAwakeable(id, {
      failure: { code: UNKNOWN_ERROR_CODE, message: reason },
    });
  }

  private completeAwakeable(
    id: string,
    base: DeepPartial<CompleteAwakeableEntryMessage>
  ): void {
    base.id = id;
    this.stateMachine
      .handleUserCodeMessage(
        COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
        CompleteAwakeableEntryMessage.create(base)
      )
      .catch((e) => this.stateMachine.handleDanglingPromiseError(e));
  }

  // Used by static methods of CombineablePromise
  public createCombinator<T extends readonly CombineablePromise<unknown>[]>(
    combinatorConstructor: (
      promises: PromiseLike<unknown>[]
    ) => Promise<unknown>,
    promises: T
  ): WrappedPromise<unknown> {
    const outPromises = [];

    for (const promise of promises) {
      if (promise.__restate_context !== this) {
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

    return this.stateMachine.createCombinator(
      combinatorConstructor,
      outPromises
    );
  }

  // -- Various private methods

  private isInSideEffect(): boolean {
    const context = ContextImpl.callContext.getStore();
    return context?.type === CallContexType.SideEffect;
  }

  private isInOneWayCall(): boolean {
    const context = ContextImpl.callContext.getStore();
    return context?.type === CallContexType.OneWayCall;
  }

  private getOneWayCallDelay(): number | undefined {
    const context = ContextImpl.callContext.getStore();
    return context?.delay;
  }

  private checkNotExecutingSideEffect() {
    if (this.executingSideEffect) {
      throw new TerminalError(
        `Invoked a RestateContext method while a side effect is still executing. 
          Make sure you await the ctx.sideEffect call before using any other RestateContext method.`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
  }

  private checkState(callType: string): void {
    const context = ContextImpl.callContext.getStore();
    if (!context) {
      this.checkNotExecutingSideEffect();
      return;
    }

    if (context.type === CallContexType.SideEffect) {
      throw new TerminalError(
        `You cannot do ${callType} calls from within a side effect.`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }

    if (context.type === CallContexType.OneWayCall) {
      throw new TerminalError(
        `Cannot do a ${callType} from within ctx.oneWayCall(...).
          Context method oneWayCall() can only be used to invoke other services in the background.
          e.g. ctx.oneWayCall(() => client.greet(my_request))`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
  }

  private checkStateOperation(callType: string): void {
    if (!this.keyedContext) {
      throw new TerminalError(
        `You can do ${callType} calls only from a virtual object`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
  }

  private markCombineablePromise<T>(
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

    return Object.defineProperties(p, {
      __restate_context: {
        value: this,
      },
      journalIndex: {
        value: journalIndex,
      },
      orTimeout: {
        value: orTimeout.bind(this),
      },
    }) as InternalCombineablePromise<T>;
  }
}

async function executeWithRetries<T>(
  console: Console,
  retrySettings: RetrySettings,
  executeAndLogSideEffect: () => Promise<T>,
  sleep: (millis: number) => Promise<void>
): Promise<T> {
  const {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = Number.MAX_SAFE_INTEGER,
    maxRetries = Number.MAX_SAFE_INTEGER,
    policy = EXPONENTIAL_BACKOFF,
    name = "side-effect",
  } = retrySettings;

  let currentDelayMs = initialDelayMs;
  let retriesLeft = maxRetries;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await executeAndLogSideEffect();
    } catch (e) {
      if (e instanceof TerminalError) {
        throw e;
      }

      // journal mismatch errors are special:
      //  - they are not terminal errors, because we want to allow pushing new code so
      //    that retries succeed later
      //  - they are not retried within the service, because they will never succeed within this service,
      //    but can only succeed within a new invocation going to service with fixed code
      //  we hence break the retries here similar to terminal errors
      if (
        e instanceof RestateError &&
        e.code == RestateErrorCodes.JOURNAL_MISMATCH
      ) {
        throw e;
      }

      const error = ensureError(e);

      console.debug(
        "Error while executing side effect '%s': %s - %s",
        name,
        error.name,
        error.message
      );
      if (error.stack) {
        console.debug(error.stack);
      }

      if (retriesLeft > 0) {
        console.debug("Retrying in %d ms", currentDelayMs);
      } else {
        console.debug("No retries left.");
        throw new TerminalError(
          `Retries exhausted for ${name}. Last error: ${error.name}: ${error.message}`,
          {
            errorCode: INTERNAL_ERROR_CODE,
          }
        );
      }
    }

    await sleep(currentDelayMs);

    retriesLeft -= 1;
    currentDelayMs = Math.min(
      policy.computeNextDelay(currentDelayMs),
      maxDelayMs
    );
  }
}
