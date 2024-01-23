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

import {
  CombineablePromise,
  Rand,
  RestateGrpcChannel,
  RestateGrpcContext,
  RpcContext,
  RpcGateway,
  ServiceApi,
} from "./restate_context";
import { StateMachine } from "./state_machine";
import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  CompleteAwakeableEntryMessage,
  DeepPartial,
  InvokeEntryMessage,
  SleepEntryMessage,
} from "./generated/proto/protocol";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_IDENTIFIER_PREFIX,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "./types/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { AsyncLocalStorage } from "async_hooks";
import {
  ErrorCodes,
  RestateErrorCodes,
  RestateError,
  RetryableError,
  TerminalError,
  ensureError,
  errorToFailureWithTerminal,
} from "./types/errors";
import { jsonSerialize, jsonDeserialize } from "./utils/utils";
import { Empty } from "./generated/google/protobuf/empty";
import {
  DEFAULT_INFINITE_EXPONENTIAL_BACKOFF,
  DEFAULT_INITIAL_DELAY_MS,
  EXPONENTIAL_BACKOFF,
  RetrySettings,
} from "./utils/public_utils";
import { Client, SendClient } from "./types/router";
import { RpcRequest, RpcResponse } from "./generated/proto/dynrpc";
import { requestFromArgs } from "./utils/assumptions";
import { RandImpl } from "./utils/rand";
import { newJournalEntryPromiseId } from "./promise_combinator_tracker";
import { WrappedPromise } from "./utils/promises";

export enum CallContexType {
  None,
  SideEffect,
  OneWayCall,
}

export interface CallContext {
  type: CallContexType;
  delay?: number;
}

export type InternalCombineablePromise<T> = CombineablePromise<T> & {
  journalIndex: number;
};

export class RestateGrpcContextImpl implements RestateGrpcContext {
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

  constructor(
    public readonly id: Buffer,
    public readonly serviceName: string,
    public readonly console: Console,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly stateMachine: StateMachine<any, any>,
    public readonly rand: Rand = new RandImpl(id)
  ) {}

  // DON'T make this function async!!! see sideEffect comment for details.
  public get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    this.checkState("get state");

    // Create the message and let the state machine process it
    const msg = this.stateMachine.localStateStore.get(name);

    const getState = async (): Promise<T | null> => {
      const result = await this.stateMachine.handleUserCodeMessage(
        GET_STATE_ENTRY_MESSAGE_TYPE,
        msg
      );

      // If the GetState message did not have a value or empty,
      // then we went to the runtime to get the value.
      // When we get the response, we set it in the localStateStore,
      // to answer subsequent requests
      if (msg.value === undefined && msg.empty === undefined) {
        this.stateMachine.localStateStore.add(name, result as Buffer | Empty);
      }

      if (!(result instanceof Buffer)) {
        return null;
      }

      return jsonDeserialize(result.toString());
    };
    return getState();
  }

  public set<T>(name: string, value: T): void {
    this.checkState("set state");
    const msg = this.stateMachine.localStateStore.set(name, value);
    this.stateMachine.handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  public clear(name: string): void {
    this.checkState("clear state");

    const msg = this.stateMachine.localStateStore.clear(name);
    this.stateMachine.handleUserCodeMessage(
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  public request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (this.isInOneWayCall()) {
      return this.invokeOneWay(service, method, data);
    } else {
      return this.invoke(service, method, data);
    }
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  private invoke(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    this.checkState("invoke");

    const msg = InvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
    });
    return this.stateMachine
      .handleUserCodeMessage(INVOKE_ENTRY_MESSAGE_TYPE, msg)
      .transform((v) => v as Uint8Array);
  }

  private async invokeOneWay(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    const delay = this.getOneWayCallDelay();
    const invokeTime = delay > 0 ? Date.now() + delay : undefined;
    const msg = BackgroundInvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
      invokeTime: invokeTime,
    });

    await this.stateMachine.handleUserCodeMessage(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    );
    return new Uint8Array();
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  public oneWayCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: () => Promise<any>
  ): Promise<void> {
    this.checkState("oneWayCall");

    return RestateGrpcContextImpl.callContext.run(
      { type: CallContexType.OneWayCall },
      call
    );
  }

  // DON'T make this function async!!! see sideEffect comment for details.
  public delayedCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: () => Promise<any>,
    delayMillis?: number
  ): Promise<void> {
    this.checkState("delayedCall");

    // Delayed call is a one way call with a delay
    return RestateGrpcContextImpl.callContext.run(
      { type: CallContexType.OneWayCall, delay: delayMillis },
      call
    );
  }

  rpcGateway(): RpcGateway {
    return new RpcContextImpl(this);
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
        { errorCode: ErrorCodes.INTERNAL }
      );
    } else if (this.isInOneWayCall()) {
      throw new TerminalError(
        "Cannot do a side effect from within ctx.oneWayCall(...). " +
          "Context method ctx.oneWayCall() can only be used to invoke other services unidirectionally. " +
          "e.g. ctx.oneWayCall(() => client.greet(my_request))",
        { errorCode: ErrorCodes.INTERNAL }
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
        sideEffectResult = await RestateGrpcContextImpl.callContext.run(
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

  private sleepInternal(millis: number): Promise<void> {
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
      id: AWAKEABLE_IDENTIFIER_PREFIX + Buffer.concat([this.id, encodedEntryIndex]).toString("base64url"),
      promise: this.markCombineablePromise(promise),
    };
  }

  public resolveAwakeable<T>(id: string, payload: T): void {
    this.checkState("resolveAwakeable");
    this.completeAwakeable(id, {
      value: Buffer.from(JSON.stringify(payload)),
    });
  }

  public rejectAwakeable(id: string, reason: string): void {
    this.checkState("rejectAwakeable");
    this.completeAwakeable(id, {
      failure: { code: ErrorCodes.UNKNOWN, message: reason },
    });
  }

  private completeAwakeable(
    id: string,
    base: DeepPartial<CompleteAwakeableEntryMessage>
  ): void {
    base.id = id;
    this.stateMachine.handleUserCodeMessage(
      COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
      CompleteAwakeableEntryMessage.create(base)
    );
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
    const context = RestateGrpcContextImpl.callContext.getStore();
    return context?.type === CallContexType.SideEffect;
  }

  private isInOneWayCall(): boolean {
    const context = RestateGrpcContextImpl.callContext.getStore();
    return context?.type === CallContexType.OneWayCall;
  }

  private getOneWayCallDelay(): number {
    const context = RestateGrpcContextImpl.callContext.getStore();
    return context?.delay || 0;
  }

  private checkNotExecutingSideEffect() {
    if (this.executingSideEffect) {
      throw new TerminalError(
        `Invoked a RestateContext method while a side effect is still executing. 
          Make sure you await the ctx.sideEffect call before using any other RestateContext method.`,
        { errorCode: ErrorCodes.INTERNAL }
      );
    }
  }

  private checkState(callType: string): void {
    const context = RestateGrpcContextImpl.callContext.getStore();
    if (!context) {
      this.checkNotExecutingSideEffect();
      return;
    }

    if (context.type === CallContexType.SideEffect) {
      throw new TerminalError(
        `You cannot do ${callType} calls from within a side effect.`,
        { errorCode: ErrorCodes.INTERNAL }
      );
    }

    if (context.type === CallContexType.OneWayCall) {
      throw new TerminalError(
        `Cannot do a ${callType} from within ctx.oneWayCall(...).
          Context method oneWayCall() can only be used to invoke other services in the background.
          e.g. ctx.oneWayCall(() => client.greet(my_request))`,
        { errorCode: ErrorCodes.INTERNAL }
      );
    }
  }

  private markCombineablePromise<T>(
    p: Promise<T>
  ): InternalCombineablePromise<T> {
    return Object.defineProperties(p, {
      __restate_context: {
        value: this,
      },
      journalIndex: {
        value: this.stateMachine.getUserCodeJournalIndex(),
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
            errorCode: ErrorCodes.INTERNAL,
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

export class RpcContextImpl implements RpcContext {
  constructor(
    private readonly ctx: RestateGrpcContext,
    public readonly id: Buffer = ctx.id,
    public readonly rand: Rand = ctx.rand,
    public readonly console: Console = ctx.console,
    public readonly serviceName: string = ctx.serviceName
  ) {}

  public rpc<M>({ path }: ServiceApi): Client<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return async (...args: unknown[]) => {
            const request = requestFromArgs(args);
            const requestBytes = RpcRequest.encode(request).finish();
            const responseBytes = await this.ctx.request(
              path,
              route,
              requestBytes
            );
            const response = RpcResponse.decode(responseBytes);
            return response.response;
          };
        },
      }
    );

    return clientProxy as Client<M>;
  }

  public send<M>(options: ServiceApi): SendClient<M> {
    return this.sendDelayed(options, 0);
  }

  public sendDelayed<M>(
    { path }: ServiceApi,
    delayMillis: number
  ): SendClient<M> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const route = prop as string;
          return (...args: unknown[]) => {
            const request = requestFromArgs(args);
            const requestBytes = RpcRequest.encode(request).finish();
            const sender = () => this.ctx.request(path, route, requestBytes);
            if (delayMillis === undefined || delayMillis === 0) {
              this.ctx.oneWayCall(sender);
            } else {
              this.ctx.delayedCall(sender, delayMillis);
            }
          };
        },
      }
    );

    return clientProxy as SendClient<M>;
  }

  public get<T>(name: string): Promise<T | null> {
    return this.ctx.get(name);
  }
  public set<T>(name: string, value: T): void {
    this.ctx.set(name, value);
  }
  public clear(name: string): void {
    this.ctx.clear(name);
  }
  public sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    return this.ctx.sideEffect(fn);
  }
  public awakeable<T>(): { id: string; promise: CombineablePromise<T> } {
    return this.ctx.awakeable();
  }
  public resolveAwakeable<T>(id: string, payload: T): void {
    this.ctx.resolveAwakeable(id, payload);
  }
  public rejectAwakeable(id: string, reason: string): void {
    this.ctx.rejectAwakeable(id, reason);
  }
  public sleep(millis: number): CombineablePromise<void> {
    return this.ctx.sleep(millis);
  }

  grpcChannel(): RestateGrpcChannel {
    return this.ctx;
  }
}
