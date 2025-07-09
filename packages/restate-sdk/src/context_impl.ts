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
  ContextDate,
  DurablePromise,
  GenericCall,
  GenericSend,
  InvocationHandle,
  InvocationId,
  InvocationPromise,
  ObjectContext,
  Rand,
  Request,
  RestatePromise,
  RunAction,
  RunOptions,
  SendOptions,
  WorkflowContext,
} from "./context.js";
import type * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  WasmCommandType,
  WasmHeader,
} from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  ensureError,
  INTERNAL_ERROR_CODE,
  logError,
  RestateError,
  RetryableError,
  TerminalError,
  UNKNOWN_ERROR_CODE,
} from "./types/errors.js";
import type { Client, SendClient } from "./types/rpc.js";
import {
  defaultSerde,
  HandlerKind,
  makeRpcCallProxy,
  makeRpcSendProxy,
} from "./types/rpc.js";
import type {
  Duration,
  Serde,
  Service,
  ServiceDefinitionFrom,
  VirtualObject,
  VirtualObjectDefinitionFrom,
  Workflow,
  WorkflowDefinitionFrom,
} from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis, serde } from "@restatedev/restate-sdk-core";
import { RandImpl } from "./utils/rand.js";
import type {
  ReadableStreamDefaultReader,
  WritableStreamDefaultWriter,
} from "node:stream/web";
import { CompletablePromise } from "./utils/completable_promise.js";
import type { AsyncResultValue, InternalRestatePromise } from "./promises.js";
import {
  extractContext,
  InvocationPendingPromise,
  pendingPromise,
  PromisesExecutor,
  RestateCombinatorPromise,
  RestateInvocationPromise,
  RestatePendingPromise,
  RestateSinglePromise,
} from "./promises.js";
import { InputPump, OutputPump } from "./io.js";

export class ContextImpl implements ObjectContext, WorkflowContext {
  public readonly rand: Rand;

  public readonly date: ContextDate = {
    now: (): Promise<number> => {
      return this.run(() => Date.now());
    },

    toJSON: (): Promise<string> => {
      return this.run(() => new Date().toJSON());
    },
  };

  private readonly outputPump: OutputPump;
  private readonly runClosuresTracker: RunClosuresTracker;
  readonly promisesExecutor: PromisesExecutor;

  constructor(
    readonly coreVm: vm.WasmVM,
    readonly input: vm.WasmInput,
    public readonly console: Console,
    public readonly handlerKind: HandlerKind,
    private readonly vmLogger: Console,
    private readonly invocationRequest: Request,
    private readonly invocationEndPromise: CompletablePromise<void>,
    inputReader: ReadableStreamDefaultReader<Uint8Array>,
    outputWriter: WritableStreamDefaultWriter<Uint8Array>,
    private readonly asTerminalError?: (error: any) => TerminalError | undefined
  ) {
    this.rand = new RandImpl(input.invocation_id, () => {
      // TODO reimplement this check with async context
      // if (coreVm.is_inside_run()) {
      //   throw new Error(
      //     "Cannot generate random numbers within a run closure. Use the random object outside the run closure."
      //   );
      // }
    });
    this.outputPump = new OutputPump(coreVm, outputWriter);
    this.runClosuresTracker = new RunClosuresTracker();
    this.promisesExecutor = new PromisesExecutor(
      coreVm,
      new InputPump(
        coreVm,
        inputReader,
        this.handleInvocationEndError.bind(this)
      ),
      this.outputPump,
      this.runClosuresTracker,
      this.promiseExecutorErrorCallback.bind(this)
    );
  }

  cancel(invocationId: InvocationId): void {
    this.processNonCompletableEntry(
      WasmCommandType.CancelInvocation,
      () => {},
      (vm) => vm.sys_cancel_invocation(invocationId)
    );
  }

  attach<T>(invocationId: InvocationId, serde?: Serde<T>): RestatePromise<T> {
    return this.processCompletableEntry(
      WasmCommandType.AttachInvocation,
      () => {},
      (vm) => vm.sys_attach_invocation(invocationId),
      SuccessWithSerde(serde ?? defaultSerde()),
      Failure
    );
  }

  public get key(): string {
    switch (this.handlerKind) {
      case HandlerKind.EXCLUSIVE:
      case HandlerKind.SHARED:
      case HandlerKind.WORKFLOW: {
        return this.input.key;
      }
      default:
        throw new TerminalError("this handler type doesn't support key()");
    }
  }

  public request(): Request {
    return this.invocationRequest;
  }

  public get<T>(name: string, serde?: Serde<T>): RestatePromise<T | null> {
    return this.processCompletableEntry(
      WasmCommandType.GetState,
      () => {},
      (vm) => vm.sys_get_state(name),
      VoidAsNull,
      SuccessWithSerde(serde ?? defaultSerde())
    );
  }

  public stateKeys(): RestatePromise<Array<string>> {
    return this.processCompletableEntry(
      WasmCommandType.GetStateKeys,
      () => {},
      (vm) => vm.sys_get_state_keys(),
      StateKeys
    );
  }

  public set<T>(name: string, value: T, serde?: Serde<T>): void {
    this.processNonCompletableEntry(
      WasmCommandType.SetState,
      () => (serde ?? defaultSerde()).serialize(value),
      (vm, bytes) => vm.sys_set_state(name, bytes)
    );
  }

  public clear(name: string): void {
    this.processNonCompletableEntry(
      WasmCommandType.ClearState,
      () => {},
      (vm) => vm.sys_clear_state(name)
    );
  }

  public clearAll(): void {
    this.processNonCompletableEntry(
      WasmCommandType.ClearAllState,
      () => {},
      (vm) => vm.sys_clear_all_state()
    );
  }

  // --- Calls, background calls, etc
  //
  public genericCall<REQ = Uint8Array, RES = Uint8Array>(
    call: GenericCall<REQ, RES>
  ): InvocationPromise<RES> {
    const requestSerde: Serde<REQ> =
      call.inputSerde ?? (serde.binary as Serde<REQ>);
    const responseSerde: Serde<RES> =
      call.outputSerde ?? (serde.binary as Serde<RES>);

    let parameter: Uint8Array;
    try {
      parameter = requestSerde.serialize(call.parameter);
    } catch (e) {
      this.handleInvocationEndError(e, (vm, error) =>
        vm.notify_error_for_next_command(
          error.message,
          error.stack,
          WasmCommandType.Call
        )
      );
      return new InvocationPendingPromise(this);
    }

    try {
      const call_handles = this.coreVm.sys_call(
        call.service,
        call.method,
        parameter,
        call.key,
        call.headers
          ? Object.entries(call.headers).map(
              ([key, value]) => new WasmHeader(key, value)
            )
          : [],
        call.idempotencyKey
      );
      const commandIndex = this.coreVm.last_command_index();

      const invocationIdPromise = new RestateSinglePromise(
        this,
        call_handles.invocation_id_completion_id,
        completeCommandPromiseUsing(
          WasmCommandType.Call,
          commandIndex,
          InvocationIdCompleter
        )
      );

      return new RestateInvocationPromise(
        this,
        call_handles.call_completion_id,
        completeCommandPromiseUsing(
          WasmCommandType.Call,
          commandIndex,
          SuccessWithSerde(responseSerde),
          Failure
        ),
        invocationIdPromise as RestatePromise<InvocationId>
      );
    } catch (e) {
      this.handleInvocationEndError(e);
      // We return a pending promise to avoid the caller to see the error.
      return new InvocationPendingPromise(this);
    }
  }

  public genericSend<REQ = Uint8Array>(
    send: GenericSend<REQ>
  ): InvocationHandle {
    const requestSerde = send.inputSerde ?? (serde.binary as Serde<REQ>);

    let parameter: Uint8Array;
    try {
      parameter = requestSerde.serialize(send.parameter);
    } catch (e) {
      this.handleInvocationEndError(e, (vm, error) =>
        vm.notify_error_for_next_command(
          error.message,
          error.stack,
          WasmCommandType.OneWayCall
        )
      );
      return new InvocationPendingPromise(this);
    }

    try {
      const delay =
        send.delay !== undefined
          ? millisOrDurationToMillis(send.delay)
          : undefined;

      const handles = this.coreVm.sys_send(
        send.service,
        send.method,
        parameter,
        send.key,
        send.headers
          ? Object.entries(send.headers).map(
              ([key, value]) => new WasmHeader(key, value)
            )
          : [],
        delay !== undefined && delay > 0 ? BigInt(delay) : undefined,
        send.idempotencyKey
      );
      const commandIndex = this.coreVm.last_command_index();

      return {
        invocationId: new RestateSinglePromise(
          this,
          handles.invocation_id_completion_id,
          completeCommandPromiseUsing(
            WasmCommandType.OneWayCall,
            commandIndex,
            InvocationIdCompleter
          )
        ),
      };
    } catch (e) {
      this.handleInvocationEndError(e);
      return {
        invocationId: pendingPromise(),
      };
    }
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
  ): RestatePromise<T> {
    const { name, action } = unpackRunParameters(
      nameOrAction,
      actionSecondParameter
    );
    const serde = options?.serde ?? defaultSerde();

    // Prepare the handle
    let handle: number;
    try {
      handle = this.coreVm.sys_run(name ?? "");
    } catch (e) {
      this.handleInvocationEndError(e);
      return new RestatePendingPromise(this);
    }
    const commandIndex = this.coreVm.last_command_index();

    // Now prepare the run task
    const doRun: () => Promise<any> = async () => {
      // Execute the user code
      const startTime = Date.now();
      let res: T;
      let err;
      try {
        res = await action();
      } catch (e) {
        err = ensureError(e, this.asTerminalError);
      }
      const attemptDuration = Date.now() - startTime;

      // Propose the completion to the VM
      try {
        if (err !== undefined) {
          if (err instanceof TerminalError) {
            // Record failure, go ahead
            this.coreVm.propose_run_completion_failure(handle, {
              code: err.code,
              message: err.message,
            });
          } else if (err instanceof RetryableError) {
            const maxRetryDuration =
              options?.maxRetryDuration ?? options?.maxRetryDurationMillis;
            this.coreVm.propose_run_completion_failure_transient_with_delay_override(
              handle,
              err.message,
              err.stack,
              BigInt(attemptDuration),
              err.retryAfter !== undefined
                ? BigInt(millisOrDurationToMillis(err.retryAfter))
                : undefined,
              options?.maxRetryAttempts,
              maxRetryDuration !== undefined
                ? BigInt(millisOrDurationToMillis(maxRetryDuration))
                : undefined
            );
          } else {
            this.vmLogger.warn(
              `Error when processing ctx.run '${name}'.\n`,
              err
            );

            // Configure the retry policy if any of the parameters are set.
            let retryPolicy;
            if (
              options?.retryIntervalFactor !== undefined ||
              options?.maxRetryAttempts !== undefined ||
              options?.initialRetryInterval !== undefined ||
              options?.initialRetryIntervalMillis !== undefined ||
              options?.maxRetryDuration !== undefined ||
              options?.maxRetryDurationMillis !== undefined ||
              options?.maxRetryInterval !== undefined ||
              options?.maxRetryIntervalMillis !== undefined
            ) {
              const maxRetryDuration =
                options?.maxRetryDuration ?? options?.maxRetryDurationMillis;
              retryPolicy = {
                factor: options?.retryIntervalFactor ?? 2.0,
                initial_interval: millisOrDurationToMillis(
                  options?.initialRetryInterval ??
                    options?.initialRetryIntervalMillis ??
                    50
                ),
                max_attempts: options?.maxRetryAttempts,
                max_duration:
                  maxRetryDuration === undefined
                    ? undefined
                    : millisOrDurationToMillis(maxRetryDuration),
                max_interval: millisOrDurationToMillis(
                  options?.maxRetryInterval ??
                    options?.maxRetryIntervalMillis ?? { seconds: 10 }
                ),
              };
            }
            this.coreVm.propose_run_completion_failure_transient(
              handle,
              err.message,
              err.stack,
              BigInt(attemptDuration),
              retryPolicy
            );
          }
        } else {
          this.coreVm.propose_run_completion_success(
            handle,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            serde.serialize(res)
          );
        }
      } catch (e) {
        this.handleInvocationEndError(e);
        return pendingPromise<T>();
      }
      await this.outputPump.awaitNextProgress();
    };

    // Register the run to execute
    this.runClosuresTracker.registerRunClosure(handle, doRun);

    // Return the promise
    return new RestateSinglePromise(
      this,
      handle,
      completeCommandPromiseUsing(
        WasmCommandType.Run,
        commandIndex,
        SuccessWithSerde(serde),
        Failure
      )
    );
  }

  public sleep(
    duration: number | Duration,
    name?: string
  ): RestatePromise<void> {
    return this.processCompletableEntry(
      WasmCommandType.Sleep,
      () => {
        if (duration === undefined) {
          throw new Error(`Duration is undefined.`);
        }
        const millis = millisOrDurationToMillis(duration);
        if (millis < 0) {
          throw new Error(
            `Invalid duration. The sleep function only accepts non-negative values. Received: ${millis}ms.`
          );
        }
        return BigInt(millis);
      },
      (vm, millis) => vm.sys_sleep(millis, name),
      VoidAsUndefined
    );
  }

  // -- Awakeables

  public awakeable<T>(serde?: Serde<T>): {
    id: string;
    promise: RestatePromise<T>;
  } {
    let awakeable: vm.WasmAwakeable;
    try {
      awakeable = this.coreVm.sys_awakeable();
    } catch (e) {
      this.handleInvocationEndError(e);
      return {
        id: "invalid",
        promise: new RestatePendingPromise(this),
      };
    }

    return {
      id: awakeable.id,
      promise: new RestateSinglePromise(
        this,
        awakeable.handle,
        completeSignalPromiseUsing(
          VoidAsUndefined,
          SuccessWithSerde(serde),
          Failure
        )
      ),
    };
  }

  public resolveAwakeable<T>(id: string, payload?: T, serde?: Serde<T>): void {
    this.processNonCompletableEntry(
      WasmCommandType.CompleteAwakeable,
      () => {
        // We coerce undefined to null as null can be stringified by JSON.stringify
        let value: Uint8Array;

        if (serde) {
          value =
            payload === undefined ? new Uint8Array() : serde.serialize(payload);
        } else {
          value =
            payload !== undefined
              ? defaultSerde().serialize(payload)
              : defaultSerde().serialize(null);
        }
        return value;
      },
      (vm, bytes) => vm.sys_complete_awakeable_success(id, bytes)
    );
  }

  public rejectAwakeable(id: string, reason: string): void {
    this.processNonCompletableEntry(
      WasmCommandType.CompleteAwakeable,
      () => {},
      (vm) => {
        vm.sys_complete_awakeable_failure(id, {
          code: UNKNOWN_ERROR_CODE,
          message: reason,
        });
      }
    );
  }

  public promise<T>(name: string, serde?: Serde<T>): DurablePromise<T> {
    return new DurablePromiseImpl(this, name, serde);
  }

  // Used by static methods of RestatePromise
  public static createCombinator<T extends readonly RestatePromise<unknown>[]>(
    combinatorConstructor: (promises: Promise<any>[]) => Promise<any>,
    promises: T
  ): RestatePromise<unknown> {
    // Extract context from first promise
    const self = extractContext(promises[0]);
    if (!self) {
      throw new Error("Not a combinable promise");
    }

    // Collect first the promises downcasted to the internal promise type
    const castedPromises: InternalRestatePromise<any>[] = [];
    for (const promise of promises) {
      if (extractContext(promise) !== self) {
        self.handleInvocationEndError(
          new Error(
            "You're mixing up RestatePromises from different RestateContext. This is not supported."
          )
        );
        return new RestatePendingPromise(self);
      }
      castedPromises.push(promise as InternalRestatePromise<any>);
    }
    return new RestateCombinatorPromise(
      self,
      combinatorConstructor,
      castedPromises
    );
  }

  // -- Various private methods

  private processNonCompletableEntry<T>(
    commandType: vm.WasmCommandType,
    prepare: () => T,
    vmCall: (vm: vm.WasmVM, input: T) => void
  ) {
    let input;
    try {
      input = prepare();
    } catch (e) {
      this.handleInvocationEndError(e, (vm, error) =>
        vm.notify_error_for_next_command(
          error.message,
          error.stack,
          commandType
        )
      );
      return;
    }

    try {
      vmCall(this.coreVm, input);
    } catch (e) {
      this.handleInvocationEndError(e);
    }
  }

  processCompletableEntry<T, U>(
    commandType: vm.WasmCommandType,
    prepare: () => T,
    vmCall: (vm: vm.WasmVM, t: T) => number,
    ...completers: Array<Completer>
  ): RestatePromise<U> {
    let input;
    try {
      input = prepare();
    } catch (e) {
      this.handleInvocationEndError(e, (vm, error) =>
        vm.notify_error_for_next_command(
          error.message,
          error.stack,
          commandType
        )
      );
      return new RestatePendingPromise(this);
    }

    let handle: number;
    try {
      handle = vmCall(this.coreVm, input);
    } catch (e) {
      this.handleInvocationEndError(e);
      return new RestatePendingPromise(this);
    }
    const commandIndex = this.coreVm.last_command_index();
    return new RestateSinglePromise(
      this,
      handle,
      completeCommandPromiseUsing(commandType, commandIndex, ...completers)
    );
  }

  promiseExecutorErrorCallback(e: unknown) {
    if (e instanceof AsyncCompleterError) {
      const cause = ensureError(e.cause);
      logError(this.vmLogger, e.cause);
      // Special handling for this one!
      this.coreVm.notify_error_for_specific_command(
        cause.message,
        cause.stack,
        e.commandType,
        e.commandIndex,
        null
      );
    } else {
      const error = ensureError(e);
      logError(this.vmLogger, error);
      if (!(error instanceof RestateError)) {
        // Notify error
        this.coreVm.notify_error(error.message, error.stack);
      }
    }

    // From now on, no progress will be made.
    this.invocationEndPromise.resolve();
  }

  handleInvocationEndError(
    e: unknown,
    notify_vm_error: (vm: vm.WasmVM, error: Error) => void = (vm, error) => {
      vm.notify_error(error.message, error.stack);
    }
  ) {
    const error = ensureError(e);
    logError(this.vmLogger, error);
    notify_vm_error(this.coreVm, error);

    // From now on, no progress will be made.
    this.invocationEndPromise.resolve();
  }
}

function unpackRunParameters<T>(
  a: string | RunAction<T>,
  b?: RunAction<T>
): { name?: string; action: RunAction<T> } {
  if (typeof a === "string") {
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

  get(): RestatePromise<T> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.GetPromise,
      () => {},
      (vm) => vm.sys_get_promise(this.name),
      SuccessWithSerde(this.serde),
      Failure
    );
  }

  peek(): Promise<T | undefined> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.PeekPromise,
      () => {},
      (vm) => vm.sys_peek_promise(this.name),
      VoidAsUndefined,
      SuccessWithSerde(this.serde),
      Failure
    );
  }

  resolve(value?: T | undefined): Promise<void> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.CompletePromise,
      () => this.serde.serialize(value as T),
      (vm, bytes) => vm.sys_complete_promise_success(this.name, bytes),
      VoidAsUndefined,
      Failure
    );
  }

  reject(errorMsg: string): Promise<void> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.CompletePromise,
      () => {},
      (vm) =>
        vm.sys_complete_promise_failure(this.name, {
          code: INTERNAL_ERROR_CODE,
          message: errorMsg,
        }),
      VoidAsUndefined,
      Failure
    );
  }
}

/// Tracker of run closures to run
export class RunClosuresTracker {
  private currentRunWaitPoint?: CompletablePromise<void>;
  private runsToExecute: Map<number, () => Promise<any>> = new Map<
    number,
    () => Promise<any>
  >();

  executeRun(handle: number) {
    const runClosure = this.runsToExecute.get(handle);
    if (runClosure === undefined) {
      throw new Error(`Handle ${handle} doesn't exist`);
    }
    runClosure()
      .finally(() => {
        this.unblockCurrentRunWaitPoint();
      })
      .catch(() => {});
  }

  registerRunClosure(handle: number, runClosure: () => Promise<any>) {
    this.runsToExecute.set(handle, runClosure);
  }

  awaitNextCompletedRun(): Promise<void> {
    if (this.currentRunWaitPoint === undefined) {
      this.currentRunWaitPoint = new CompletablePromise();
    }
    return this.currentRunWaitPoint.promise;
  }

  private unblockCurrentRunWaitPoint() {
    if (this.currentRunWaitPoint !== undefined) {
      const p = this.currentRunWaitPoint;
      this.currentRunWaitPoint = undefined;
      p.resolve();
    }
  }
}

// ---- Functions used to parse async results

type Completer = (
  value: AsyncResultValue,
  prom: CompletablePromise<any>
) => boolean;

// This is just a special type we use to propagate completer errors between this function and handleInvocationEndError
class AsyncCompleterError {
  constructor(
    readonly cause: any,
    readonly commandType: WasmCommandType,
    readonly commandIndex: number
  ) {}
}

function completeCommandPromiseUsing<T>(
  commandType: WasmCommandType,
  commandIndex: number,
  ...completers: Array<Completer>
): (value: AsyncResultValue, prom: CompletablePromise<T>) => void {
  return (value: AsyncResultValue, prom: CompletablePromise<any>) => {
    try {
      for (const completer of completers) {
        if (completer(value, prom)) {
          return;
        }
      }
    } catch (e) {
      throw new AsyncCompleterError(e, commandType, commandIndex);
    }

    throw new Error(
      `Unexpected variant in async result: ${JSON.stringify(value)}`
    );
  };
}

// This is like the function above, but won't decorate the error with the command metadata
function completeSignalPromiseUsing<T>(
  ...completers: Array<Completer>
): (value: AsyncResultValue, prom: CompletablePromise<T>) => void {
  return (value: AsyncResultValue, prom: CompletablePromise<any>) => {
    for (const completer of completers) {
      if (completer(value, prom)) {
        return;
      }
    }

    throw new Error(
      `Unexpected variant in async result: ${JSON.stringify(value)}`
    );
  };
}

const VoidAsNull: Completer = (value, prom) => {
  if (value === "Empty") {
    prom.resolve(null);
    return true;
  }
  return false;
};
const VoidAsUndefined: Completer = (value, prom) => {
  if (value === "Empty") {
    prom.resolve(undefined);
    return true;
  }
  return false;
};

function SuccessWithSerde<T>(
  serde?: Serde<T>,
  transform?: <U>(success: T) => U
): Completer {
  return (value, prom) => {
    if (typeof value !== "object" || !("Success" in value)) {
      return false;
    }
    let val: T;
    if (serde) {
      val = serde.deserialize(value.Success);
    } else {
      val = defaultSerde<T>().deserialize(value.Success);
    }
    if (transform) {
      val = transform(val);
    }
    prom.resolve(val);
    return true;
  };
}

const Failure: Completer = (value, prom) => {
  if (typeof value === "object" && "Failure" in value) {
    prom.reject(
      new TerminalError(value.Failure.message, {
        errorCode: value.Failure.code,
      })
    );
    return true;
  }
  return false;
};

const StateKeys: Completer = (value, prom) => {
  if (typeof value === "object" && "StateKeys" in value) {
    prom.resolve(value.StateKeys);
    return true;
  }
  return false;
};

const InvocationIdCompleter: Completer = (value, prom) => {
  if (typeof value === "object" && "InvocationId" in value) {
    prom.resolve(value.InvocationId);
    return true;
  }
  return false;
};
