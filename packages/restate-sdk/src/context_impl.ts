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
import type * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  TerminalError,
  ensureError,
  UNKNOWN_ERROR_CODE,
  INTERNAL_ERROR_CODE,
  TimeoutError,
} from "./types/errors.js";
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
import type { Headers } from "./endpoint/handlers/generic.js";
import type {
  ReadableStreamDefaultReader,
  WritableStreamDefaultWriter,
} from "node:stream/web";

export type InternalCombineablePromise<T> = CombineablePromise<T> & {
  asyncResultHandle: number;
};

export class ContextImpl implements ObjectContext, WorkflowContext {
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
    readonly coreVm: vm.WasmVM,
    readonly input: vm.WasmInput,
    public readonly console: Console,
    public readonly handlerKind: HandlerKind,
    attemptHeaders: Headers,
    extraArgs: unknown[],
    private readonly inputReader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly outputWriter: WritableStreamDefaultWriter<Uint8Array>
  ) {
    this.invocationRequest = {
      id: input.invocation_id,
      headers: input.headers.reduce((headers, { key, value }) => {
        headers.set(key, value);
        return headers;
      }, new Map()),
      attemptHeaders: Object.entries(attemptHeaders).reduce(
        (headers, [key, value]) => {
          if (value != undefined) {
            headers.set(key, value instanceof Array ? value[0] : value);
          }
          return headers;
        },
        new Map()
      ),
      body: input.input,
      extraArgs,
    };

    this.rand = new RandImpl(input.invocation_id, () => {
      if (coreVm.is_inside_run()) {
        const err = new Error(
          "Cannot generate random numbers within a run closure. Use the random object outside the run closure."
        );
        coreVm.notify_error(err.message, err.stack);
        throw err;
      }
    });
  }

  public get key(): string {
    switch (this.handlerKind) {
      case HandlerKind.EXCLUSIVE:
      case HandlerKind.SHARED:
      case HandlerKind.WORKFLOW: {
        return this.input.key;
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
    const handle = this.coreVm.sys_get_state(name);
    return new LazyContextPromise(handle, this, () =>
      this.pollAsyncResult(handle, (asyncResultValue) => {
        if (asyncResultValue == "Empty") {
          // Empty
          return null;
        } else if ("Success" in asyncResultValue) {
          return (serde ?? defaultSerde()).deserialize(
            asyncResultValue.Success
          );
        } else if ("Failure" in asyncResultValue) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  public stateKeys(): Promise<Array<string>> {
    const handle = this.coreVm.sys_get_state_keys();
    return new LazyContextPromise(handle, this, () =>
      this.pollAsyncResult(handle, (asyncResultValue) => {
        if (
          typeof asyncResultValue === "object" &&
          "StateKeys" in asyncResultValue
        ) {
          return asyncResultValue.StateKeys;
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  public set<T>(name: string, value: T, serde?: Serde<T>): void {
    this.coreVm.sys_set_state(
      name,
      this.runWrappingError(() => (serde ?? defaultSerde()).serialize(value))
    );
  }

  public clear(name: string): void {
    this.coreVm.sys_clear_state(name);
  }

  public clearAll(): void {
    this.coreVm.sys_clear_all_state();
  }

  // --- Calls, background calls, etc
  //
  public genericCall<REQ = Uint8Array, RES = Uint8Array>(
    call: GenericCall<REQ, RES>
  ): CombineablePromise<RES> {
    const requestSerde: Serde<REQ> =
      call.inputSerde ?? (serde.binary as Serde<REQ>);
    const responseSerde: Serde<RES> =
      call.outputSerde ?? (serde.binary as Serde<RES>);
    const parameter = this.runWrappingError(() =>
      requestSerde.serialize(call.parameter)
    );

    const handle = this.coreVm.sys_call(
      call.service,
      call.method,
      parameter,
      call.key
    );
    return new LazyContextPromise(handle, this, () =>
      this.pollAsyncResult(handle, (asyncResultValue) => {
        if (
          typeof asyncResultValue === "object" &&
          "Success" in asyncResultValue
        ) {
          return responseSerde.deserialize(asyncResultValue.Success);
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  public genericSend<REQ = Uint8Array>(send: GenericSend<REQ>) {
    const requestSerde = send.inputSerde ?? (serde.binary as Serde<REQ>);
    const parameter = this.runWrappingError(() =>
      requestSerde.serialize(send.parameter)
    );

    let delay;
    if (send.delay != undefined) {
      delay = BigInt(send.delay);
    }

    this.coreVm.sys_send(send.service, send.method, parameter, send.key, delay);
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
    const { name, action } = unpack(nameOrAction, actionSecondParameter);
    const serde = options?.serde ?? defaultSerde();

    const runEnterResult = this.coreVm.sys_run_enter(name || "");

    // Check if the run was already executed
    if (
      typeof runEnterResult === "object" &&
      "ExecutedWithSuccess" in runEnterResult
    ) {
      return Promise.resolve(
        this.runWrappingError(() =>
          serde.deserialize(runEnterResult.ExecutedWithSuccess)
        )
      );
    } else if (
      typeof runEnterResult === "object" &&
      "ExecutedWithFailure" in runEnterResult
    ) {
      return Promise.reject(
        new TerminalError(runEnterResult.ExecutedWithFailure.message, {
          errorCode: runEnterResult.ExecutedWithFailure.code,
        })
      );
    }

    // We wrap the rest of the execution in this closure to create a future
    const doRun = async () => {
      let res: T;
      let err;
      try {
        res = await action();
      } catch (e) {
        err = ensureError(e);
      }

      // Record the result/failure, get back the handle for the ack.
      let handle;
      if (err != undefined) {
        if (err instanceof TerminalError) {
          // Record failure, go ahead
          handle = this.coreVm.sys_run_exit_failure({
            code: err.code,
            message: err.message,
          });
        } else {
          // TODO plug retries here!
          throw err;
        }
      } else {
        handle = this.coreVm.sys_run_exit_success(
          this.runWrappingError(() => serde.serialize(res))
        );
      }

      // Got the handle, wait for the result now (which we get once we get the ack)
      return await this.pollAsyncResult(handle, (asyncResultValue) => {
        if (
          typeof asyncResultValue === "object" &&
          "Success" in asyncResultValue
        ) {
          return serde.deserialize(asyncResultValue.Success);
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      });
    };

    return doRun();
  }

  public sleep(millis: number): CombineablePromise<void> {
    const handle = this.coreVm.sys_sleep(BigInt(millis));
    return new LazyContextPromise(handle, this, () =>
      this.pollAsyncResult(handle, (asyncResultValue) => {
        if (asyncResultValue == "Empty") {
          // Empty
          return undefined as void;
        } else if ("Failure" in asyncResultValue) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  // -- Awakeables

  public awakeable<T>(serde?: Serde<T>): {
    id: string;
    promise: CombineablePromise<T>;
  } {
    const awakeable = this.coreVm.sys_awakeable();
    return {
      id: awakeable.id,
      promise: new LazyContextPromise(awakeable.handle, this, () =>
        this.pollAsyncResult(awakeable.handle, (asyncResultValue) => {
          if (
            typeof asyncResultValue === "object" &&
            "Success" in asyncResultValue
          ) {
            if (!serde) {
              return defaultSerde<T>().deserialize(asyncResultValue.Success);
            }
            if (asyncResultValue.Success.length == 0) {
              return undefined as T;
            }
            return serde.deserialize(asyncResultValue.Success);
          } else if (
            typeof asyncResultValue === "object" &&
            "Failure" in asyncResultValue
          ) {
            throw new TerminalError(asyncResultValue.Failure.message, {
              errorCode: asyncResultValue.Failure.code,
            });
          }
          throw new Error(
            `Unexpected variant in async result: ${JSON.stringify(
              asyncResultValue
            )}`
          );
        })
      ),
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

    this.coreVm.sys_complete_awakeable_success(id, value);
  }

  public rejectAwakeable(id: string, reason: string): void {
    this.coreVm.sys_complete_awakeable_failure(id, {
      code: UNKNOWN_ERROR_CODE,
      message: reason,
    });
  }

  public promise<T>(name: string, serde?: Serde<T>): DurablePromise<T> {
    return new DurablePromiseImpl(this, name, serde);
  }

  // Used by static methods of CombineablePromise
  public static createCombinator<
    T extends readonly CombineablePromise<unknown>[]
  >(combinatorType: PromiseCombinatorType, promises: T): Promise<unknown> {
    // Extract context from first promise
    const self = extractContext(promises[0]);
    if (!self) {
      throw new Error("Not a combinable promise");
    }

    // Collect first the promises downcasted to the internal promise type
    const castedPromises: InternalCombineablePromise<unknown>[] = [];
    for (const promise of promises) {
      if (extractContext(promise) !== self) {
        throw new Error(
          "You're mixing up CombineablePromises from different RestateContext. This is not supported."
        );
      }
      castedPromises.push(promise as InternalCombineablePromise<unknown>);
    }
    const handles = new Uint32Array(
      castedPromises.map((p) => p.asyncResultHandle)
    );

    // From now on, lazily executes on await
    return new LazyPromise(async () => {
      // Take output
      const nextOutput1 = self.coreVm.take_output() as
        | Uint8Array
        | null
        | undefined;
      if (nextOutput1 instanceof Uint8Array) {
        await self.outputWriter.write(nextOutput1);
      }

      let combinatorResultHandle;
      for (;;) {
        switch (combinatorType) {
          case "All":
            combinatorResultHandle =
              self.coreVm.sys_try_complete_all_combinator(handles);
            break;
          case "Any":
            combinatorResultHandle =
              self.coreVm.sys_try_complete_any_combinator(handles);
            break;
          case "AllSettled":
            combinatorResultHandle =
              self.coreVm.sys_try_complete_all_settled_combinator(handles);
            break;
          case "Race":
          case "OrTimeout":
            combinatorResultHandle =
              self.coreVm.sys_try_complete_race_combinator(handles);
            break;
        }

        // We got a result, we're done in this loop
        if (combinatorResultHandle !== undefined) {
          break;
        }

        // No result yet, take input, and notify it to the vm
        const nextValue = await self.inputReader.read();
        if (nextValue.value !== undefined) {
          self.coreVm.notify_input(nextValue.value);
        }
        if (nextValue.done) {
          self.coreVm.notify_input_closed();
        }
      }

      // We got a result, we need to take_output to write the combinator entry, then we need to poll the result
      const nextOutput = self.coreVm.take_output() as
        | Uint8Array
        | null
        | undefined;
      if (nextOutput instanceof Uint8Array) {
        await self.outputWriter.write(nextOutput);
      }

      const handlesResult = await self.pollAsyncResult(
        combinatorResultHandle,
        (asyncResultValue) => {
          if (
            typeof asyncResultValue === "object" &&
            "CombinatorResult" in asyncResultValue
          ) {
            return asyncResultValue.CombinatorResult;
          }

          throw new Error(
            `Unexpected variant in async result: ${JSON.stringify(
              asyncResultValue
            )}`
          );
        }
      );

      const promisesMap = new Map(
        castedPromises.map((p) => [p.asyncResultHandle, p])
      );

      // Now all we need to do is to construct the final output based on the handles,
      // this depends on combinators themselves.
      switch (combinatorType) {
        case "All":
          return this.extractAllCombinatorResult(handlesResult, promisesMap);
        case "Any":
          return this.extractAnyCombinatorResult(handlesResult, promisesMap);
        case "AllSettled":
          return this.extractAllSettledCombinatorResult(
            handlesResult,
            promisesMap
          );
        case "Race":
          // Just one promise succeeded
          return promisesMap.get(handlesResult[0]);
        case "OrTimeout":
          // The sleep promise is always the second one in the list.
          if (handlesResult[0] == castedPromises[1].asyncResultHandle) {
            return Promise.reject(new TimeoutError());
          } else {
            return promisesMap.get(handlesResult[0]);
          }
      }
    });
  }

  private static async extractAllCombinatorResult(
    handlesResult: number[],
    promisesMap: Map<number, Promise<unknown>>
  ): Promise<unknown[]> {
    // The result can either all values, or one error
    const resultValues = [];
    for (const handle of handlesResult) {
      try {
        resultValues.push(await promisesMap.get(handle));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve(resultValues);
  }

  private static async extractAnyCombinatorResult(
    handlesResult: number[],
    promisesMap: Map<number, Promise<unknown>>
  ): Promise<unknown> {
    // The result can either be one value, or a list of errors
    const resultFailures = [];
    for (const handle of handlesResult) {
      try {
        return Promise.resolve(await promisesMap.get(handle));
      } catch (e) {
        resultFailures.push(e);
      }
    }
    // Giving back the cause here is completely fine, because all these errors in Aggregate error are Terminal errors!
    return Promise.reject(
      new TerminalError("All input promises failed", {
        cause: new AggregateError(resultFailures),
      })
    );
  }

  private static async extractAllSettledCombinatorResult(
    handlesResult: number[],
    promisesMap: Map<number, Promise<unknown>>
  ): Promise<unknown[]> {
    const resultValues = [];
    for (const handle of handlesResult) {
      try {
        resultValues.push(await promisesMap.get(handle));
      } catch (e) {
        resultValues.push(e);
      }
    }
    return Promise.resolve(resultValues);
  }

  private static async extractOrTimeoutCombinatorResult(
    handlesResult: number[],
    promisesMap: Map<number, Promise<unknown>>
  ): Promise<unknown[]> {
    // The result can either all values, or one error
    const resultValues = [];
    for (const handle of handlesResult) {
      try {
        resultValues.push(await promisesMap.get(handle));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve(resultValues);
  }

  // -- Various private methods

  runWrappingError<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      const error = ensureError(e);
      if (error instanceof TerminalError) {
        // Just rethrow it
        throw error;
      }

      this.coreVm.notify_error(error.message, error.stack);
      throw error;
    }
  }

  async pollAsyncResult<T>(
    handle: number,
    transformer: (
      value:
        | "Empty"
        | { Success: Uint8Array }
        | { Failure: vm.WasmFailure }
        | { StateKeys: string[] }
        | { CombinatorResult: number[] }
    ) => T
  ): Promise<T> {
    // Take output
    const nextOutput = this.coreVm.take_output() as
      | Uint8Array
      | null
      | undefined;
    if (nextOutput instanceof Uint8Array) {
      await this.outputWriter.write(nextOutput);
    }

    // Notify await point
    this.coreVm.notify_await_point(handle);

    // Now loop waiting for the async result
    let asyncResult = this.coreVm.take_async_result(handle);
    while (asyncResult == "NotReady") {
      // Take input, and notify it to the vm
      const nextValue = await this.inputReader.read();
      if (nextValue.value !== undefined) {
        this.coreVm.notify_input(nextValue.value);
      }
      if (nextValue.done) {
        this.coreVm.notify_input_closed();
      }
      asyncResult = this.coreVm.take_async_result(handle);
    }

    return this.runWrappingError(() => transformer(asyncResult));
  }
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
    serde?: Serde<T>
  ) {
    this.serde = serde ?? defaultSerde();
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
    const handle = this.ctx.coreVm.sys_get_promise(this.name);
    return new LazyContextPromise(handle, this.ctx, () =>
      this.ctx.pollAsyncResult(handle, (asyncResultValue) => {
        if (
          typeof asyncResultValue === "object" &&
          "Success" in asyncResultValue
        ) {
          return this.serde.deserialize(asyncResultValue.Success);
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  peek(): Promise<T | undefined> {
    const handle = this.ctx.coreVm.sys_peek_promise(this.name);
    return new LazyContextPromise(handle, this.ctx, () =>
      this.ctx.pollAsyncResult(handle, (asyncResultValue) => {
        if (asyncResultValue === "Empty") {
          return undefined;
        } else if (
          typeof asyncResultValue === "object" &&
          "Success" in asyncResultValue
        ) {
          return this.serde.deserialize(asyncResultValue.Success);
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  resolve(value?: T | undefined): Promise<void> {
    const handle = this.ctx.coreVm.sys_complete_promise_success(
      this.name,
      this.ctx.runWrappingError(() => this.serde.serialize(value as T))
    );
    return new LazyContextPromise(handle, this.ctx, () =>
      this.ctx.pollAsyncResult(handle, (asyncResultValue) => {
        if (asyncResultValue === "Empty") {
          return undefined;
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }

  reject(errorMsg: string): Promise<void> {
    const handle = this.ctx.coreVm.sys_complete_promise_failure(this.name, {
      code: INTERNAL_ERROR_CODE,
      message: errorMsg,
    });
    return new LazyContextPromise(handle, this.ctx, () =>
      this.ctx.pollAsyncResult(handle, (asyncResultValue) => {
        if (asyncResultValue === "Empty") {
          return undefined;
        } else if (
          typeof asyncResultValue === "object" &&
          "Failure" in asyncResultValue
        ) {
          throw new TerminalError(asyncResultValue.Failure.message, {
            errorCode: asyncResultValue.Failure.code,
          });
        }
        throw new Error(
          `Unexpected variant in async result: ${JSON.stringify(
            asyncResultValue
          )}`
        );
      })
    );
  }
}

class LazyPromise<T> implements Promise<T> {
  private _promise?: Promise<T>;

  constructor(private readonly executor: () => Promise<T>) {}

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
    this._promise = this._promise || this.executor();
    return this._promise.then(onfulfilled, onrejected);
  }
  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | null
      | undefined
  ): Promise<T | TResult> {
    this._promise = this._promise || this.executor();
    return this._promise.catch(onrejected);
  }
  finally(onfinally?: (() => void) | null | undefined): Promise<T> {
    this._promise = this._promise || this.executor();
    return this._promise.finally(onfinally);
  }

  readonly [Symbol.toStringTag] = "LazyPromise";
}

class LazyContextPromise<T>
  extends LazyPromise<T>
  implements InternalCombineablePromise<T>
{
  [RESTATE_CTX_SYMBOL]: ContextImpl;

  constructor(
    readonly asyncResultHandle: number,
    ctx: ContextImpl,
    executor: () => Promise<T>
  ) {
    super(executor);
    this[RESTATE_CTX_SYMBOL] = ctx;
  }

  orTimeout(millis: number): Promise<T> {
    return ContextImpl.createCombinator("OrTimeout", [
      this,
      this[RESTATE_CTX_SYMBOL].sleep(millis),
    ]) as Promise<T>;
  }
}

type PromiseCombinatorType =
  | "All"
  | "Any"
  | "AllSettled"
  | "Race"
  | "OrTimeout";
