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
  InvocationReference,
  ObjectContext,
  Rand,
  Request,
  RestatePromise,
  RunAction,
  RunOptions,
  SignalReference,
  ScopedContext,
  WorkflowContext,
} from "./context.js";
import type * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  WasmCommandType,
  WasmHeader,
  WasmInput,
  WasmVM,
} from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  ensureError,
  INTERNAL_ERROR_CODE,
  PauseError,
  RetryableError,
  TerminalError,
  UNKNOWN_ERROR_CODE,
} from "./types/errors.js";
import {
  HandlerKind,
  makeRpcCallProxy,
  makeRpcSendProxy,
} from "./types/rpc.js";
import type {
  Duration,
  JournalValueCodec,
  Serde,
  HandlerDescriptor,
} from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis, serde } from "@restatedev/restate-sdk-core";
import { RandImpl } from "./utils/rand.js";
import { AsyncResultValue, CombinatorRestatePromise } from "./promises.js";
import {
  ConstRestatePromise,
  pendingPromise,
  PromisesExecutor,
  InvocationRestatePromise,
  SingleRestatePromise,
} from "./promises.js";
import { InputPump, OutputPump } from "./io.js";
import { ExternalProgressChannel } from "./utils/external_progress_channel.js";
import type { ContextInternal, GetProjectOptions } from "./internal.js";
import { InputReader, OutputWriter } from "./endpoint/handlers/types.js";
import { ExecutionOptions } from "./endpoint/components.js";

/**
 * The runtime shape a client method needs. implement() and type manipulations respect this.
 */
type ClientTarget = {
  name: string;
  _handlers?: Record<string, HandlerDescriptor>;
  _kind?: "service" | "object" | "workflow";
};

export class ContextImpl
  implements ObjectContext, WorkflowContext, ContextInternal
{
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
  readonly inputPump: InputPump;
  private readonly runClosuresTracker: RunClosuresTracker;
  private readonly ephemeralRequestTracker: EphemeralRequestTracker;
  readonly promisesExecutor: PromisesExecutor;
  private readonly serviceKey: string;
  private runInterceptor: (
    name: string,
    runner: () => Promise<void>
  ) => Promise<void>;
  private cancellationPromise?: SingleRestatePromise<void>;
  readonly defaultSerde: Serde<any>;
  private readonly asTerminalError?: (error: any) => TerminalError | undefined;

  // If undefined, we're not tracking invocation id promises
  private readonly trackedInvocationIdPromises?: SingleRestatePromise<string>[];

  constructor(
    readonly coreVm: WasmVM,
    input: WasmInput,
    public readonly console: Console,
    public readonly handlerKind: HandlerKind,
    readonly vmLogger: Console,
    private readonly invocationRequest: Request,
    readonly invocationEndPromise: PromiseWithResolvers<void>,
    inputReader: InputReader,
    outputWriter: OutputWriter,
    readonly journalValueCodec: JournalValueCodec,
    executionOptions?: ExecutionOptions
  ) {
    this.rand = new RandImpl(input.random_seed, () => {
      // TODO reimplement this check with async context
      // if (coreVm.is_inside_run()) {
      //   throw new Error(
      //     "Cannot generate random numbers within a run closure. Use the random object outside the run closure."
      //   );
      // }
    });
    this.outputPump = new OutputPump(coreVm, outputWriter);
    const externalProgressChannel = new ExternalProgressChannel();
    this.runClosuresTracker = new RunClosuresTracker(externalProgressChannel);
    this.ephemeralRequestTracker = new EphemeralRequestTracker(
      externalProgressChannel
    );
    this.inputPump = new InputPump(
      coreVm,
      inputReader,
      externalProgressChannel,
      this.abortAttempt.bind(this)
    );
    this.promisesExecutor = new PromisesExecutor(
      coreVm,
      this.outputPump,
      this.runClosuresTracker,
      this.ephemeralRequestTracker,
      externalProgressChannel,
      this.abortAttempt.bind(this)
    );
    this.serviceKey = input.key;
    // Identity interceptor by default; replaced by startUserHandler after hooks are instantiated
    this.runInterceptor = (_name, runner) => runner();
    this.defaultSerde = executionOptions?.defaultSerde ?? serde.json;
    this.asTerminalError = executionOptions?.asTerminalError;
    this.trackedInvocationIdPromises = executionOptions?.explicitCancellation
      ? []
      : undefined;
  }

  setRunInterceptor(
    interceptor: (name: string, runner: () => Promise<void>) => Promise<void>
  ) {
    this.runInterceptor = interceptor;
  }

  isProcessing(): boolean {
    return this.coreVm.is_processing();
  }

  cancel(invocationId: InvocationId): void {
    this._cancel(invocationId);
  }

  private _cancel(invocationId: string): void {
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
      SuccessWithSerde(serde ?? this.defaultSerde, this.journalValueCodec),
      Failure
    );
  }

  public get key(): string {
    switch (this.handlerKind) {
      case HandlerKind.EXCLUSIVE:
      case HandlerKind.SHARED:
      case HandlerKind.WORKFLOW: {
        return this.serviceKey;
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
      SuccessWithSerde(serde ?? this.defaultSerde, this.journalValueCodec)
    );
  }

  // DON'T make this function async, for the same reasons of run.
  public getProject<TValue, TResult>(
    name: string,
    projection: (value: TValue | null) => TResult | Promise<TResult>,
    options?: GetProjectOptions<TValue, TResult>
  ): RestatePromise<TResult> {
    const stateSerde: Serde<TValue> =
      options?.serde ?? (this.defaultSerde as Serde<TValue>);
    // The state value is read without recording it in the journal,
    // only the projection result is recorded, as a regular run.
    return this.run(
      `project:${name}`,
      async () => projection(await this.ephemeralStateGet(name, stateSerde)),
      {
        // If only the state serde is set, use it for the projection result too.
        serde:
          options?.resultSerde ??
          (options?.serde as Serde<TResult> | undefined),
      }
    );
  }

  /**
   * Get the state value with an ephemeral command: neither the command nor its notification are recorded in the journal.
   * Because of this, the returned value MUST be used only within a run closure.
   *
   * The returned promise is completed only if a Restate's DurablePromise is being awaited.
   */
  private ephemeralStateGet<T>(
    name: string,
    serde: Serde<T>
  ): Promise<T | null> {
    let ephemeralCompletionId: number;
    try {
      ephemeralCompletionId = this.coreVm.ephemeral_state_get(name);
    } catch (e) {
      this.abortAttempt(e);
      return pendingPromise();
    }
    return this.ephemeralRequestTracker.register(
      ephemeralCompletionId,
      completeUsing<T | null>(
        {},
        VoidAsNull,
        SuccessWithSerde(serde, this.journalValueCodec)
      )
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
      () =>
        this.journalValueCodec.encode(
          (serde ?? this.defaultSerde).serialize(value)
        ),
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
      parameter = this.journalValueCodec.encode(
        requestSerde.serialize(call.parameter)
      );
    } catch (e) {
      this.abortAttempt(e, WasmCommandType.Call);
      return Object.assign(ConstRestatePromise.pending<RES>(), {
        invocationId: pendingPromise<InvocationId>(),
      });
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
        call.idempotencyKey,
        call.scope,
        call.limitKey,
        call.name
      );
      const commandIndex = this.coreVm.last_command_index();

      const invocationIdPromise = new SingleRestatePromise(
        this,
        call_handles.invocation_id_completion_id,
        completeUsing(
          {
            command: {
              type: WasmCommandType.Call,
              index: commandIndex,
            },
          },
          InvocationIdCompleter
        )
      );

      this.trackedInvocationIdPromises?.push(
        invocationIdPromise as SingleRestatePromise<string>
      );

      return new InvocationRestatePromise(
        this,
        call_handles.call_completion_id,
        completeUsing(
          {
            command: {
              type: WasmCommandType.Call,
              index: commandIndex,
            },
          },
          SuccessWithSerde(responseSerde, this.journalValueCodec),
          Failure
        ),
        invocationIdPromise as RestatePromise<InvocationId>
      );
    } catch (e) {
      this.abortAttempt(e);
      // We return a pending promise to avoid the caller to see the error.
      return Object.assign(ConstRestatePromise.pending<RES>(), {
        invocationId: pendingPromise<InvocationId>(),
      });
    }
  }

  public genericSend<REQ = Uint8Array>(
    send: GenericSend<REQ>
  ): InvocationHandle {
    const requestSerde = send.inputSerde ?? (serde.binary as Serde<REQ>);

    let parameter: Uint8Array;
    try {
      parameter = this.journalValueCodec.encode(
        requestSerde.serialize(send.parameter)
      );
    } catch (e) {
      this.abortAttempt(e, WasmCommandType.OneWayCall);
      return Object.assign(ConstRestatePromise.pending<void>(), {
        invocationId: pendingPromise<InvocationId>(),
      });
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
        send.idempotencyKey,
        send.scope,
        send.limitKey,
        send.name
      );
      const commandIndex = this.coreVm.last_command_index();

      return {
        invocationId: new SingleRestatePromise(
          this,
          handles.invocation_id_completion_id,
          completeUsing(
            {
              command: {
                type: WasmCommandType.OneWayCall,
                index: commandIndex,
              },
            },
            InvocationIdCompleter
          )
        ),
      };
    } catch (e) {
      this.abortAttempt(e);
      return {
        invocationId: pendingPromise(),
      };
    }
  }

  // The public overloaded signatures (classic definition OR service interface)
  // live on the Context interface; these implementations are permissive and
  // forward `def._handlers` (present on interface / implement() values, absent
  // on classic definitions → serde reuse is a no-op there).
  serviceClient(def: ClientTarget): any {
    return makeRpcCallProxy(
      (call) => this.genericCall(call),
      this.defaultSerde,
      def.name,
      undefined,
      undefined,
      def._handlers
    );
  }

  objectClient(def: ClientTarget, key: string): any {
    return makeRpcCallProxy(
      (call) => this.genericCall(call),
      this.defaultSerde,
      def.name,
      key,
      undefined,
      def._handlers
    );
  }

  workflowClient(def: ClientTarget, key: string): any {
    return makeRpcCallProxy(
      (call) => this.genericCall(call),
      this.defaultSerde,
      def.name,
      key,
      undefined,
      def._handlers
    );
  }

  public serviceSendClient(def: ClientTarget): any {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      this.defaultSerde,
      def.name,
      undefined,
      undefined,
      def._handlers
    );
  }

  public objectSendClient(def: ClientTarget, key: string): any {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      this.defaultSerde,
      def.name,
      key,
      undefined,
      def._handlers
    );
  }

  workflowSendClient(def: ClientTarget, key: string): any {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      this.defaultSerde,
      def.name,
      key,
      undefined,
      def._handlers
    );
  }

  // Factory that dispatches on the interface's kind — mirrors the ingress
  // client's `client(def)` / `sendClient(def)` ergonomics.
  client(def: ClientTarget, key?: string): any {
    return def._kind === "service"
      ? this.serviceClient(def)
      : this.objectClient(def, key as string);
  }

  sendClient(def: ClientTarget, key?: string): any {
    return def._kind === "service"
      ? this.serviceSendClient(def)
      : this.objectSendClient(def, key as string);
  }

  scope(scopeKey: string): ScopedContext {
    return {
      serviceClient: (def: ClientTarget): any =>
        makeRpcCallProxy(
          (call) => this.genericCall(call),
          this.defaultSerde,
          def.name,
          undefined,
          scopeKey,
          def._handlers
        ),
      serviceSendClient: (def: ClientTarget): any =>
        makeRpcSendProxy(
          (send) => this.genericSend(send),
          this.defaultSerde,
          def.name,
          undefined,
          scopeKey,
          def._handlers
        ),
      objectClient: (def: ClientTarget, key: string): any =>
        makeRpcCallProxy(
          (call) => this.genericCall(call),
          this.defaultSerde,
          def.name,
          key,
          scopeKey,
          def._handlers
        ),
      objectSendClient: (def: ClientTarget, key: string): any =>
        makeRpcSendProxy(
          (send) => this.genericSend(send),
          this.defaultSerde,
          def.name,
          key,
          scopeKey,
          def._handlers
        ),
      workflowClient: (def: ClientTarget, key: string): any =>
        makeRpcCallProxy(
          (call) => this.genericCall(call),
          this.defaultSerde,
          def.name,
          key,
          scopeKey,
          def._handlers
        ),
      workflowSendClient: (def: ClientTarget, key: string): any =>
        makeRpcSendProxy(
          (send) => this.genericSend(send),
          this.defaultSerde,
          def.name,
          key,
          scopeKey,
          def._handlers
        ),
      client: (def: ClientTarget, key?: string): any =>
        makeRpcCallProxy(
          (call) => this.genericCall(call),
          this.defaultSerde,
          def.name,
          def._kind === "service" ? undefined : key,
          scopeKey,
          def._handlers
        ),
      sendClient: (def: ClientTarget, key?: string): any =>
        makeRpcSendProxy(
          (send) => this.genericSend(send),
          this.defaultSerde,
          def.name,
          def._kind === "service" ? undefined : key,
          scopeKey,
          def._handlers
        ),
    };
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
    const serde = options?.serde ?? this.defaultSerde;

    // Prepare the handle
    let wasmRun: vm.WasmRun;
    try {
      wasmRun = this.coreVm.sys_run(name ?? "");
    } catch (e) {
      this.abortAttempt(e);
      return ConstRestatePromise.pending();
    }
    const handle = wasmRun.handle;
    const commandIndex = this.coreVm.last_command_index();

    if (!wasmRun.replayed) {
      // Let's prepare the run task only if the run wasnt replayed.
      const doRun: () => Promise<any> = async () => {
        // Execute the user code, wrapping with run interceptor hooks
        const startTime = Date.now();
        let res: T;
        let err;
        try {
          await this.runInterceptor(name ?? "", async () => {
            res = await action();
          });
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
                metadata: Object.entries(err.metadata ?? {}).map(
                  ([key, value]) => ({ key, value })
                ),
              });
            } else if (err instanceof RetryableError) {
              this.coreVm.propose_run_completion_failure_transient_with_delay_override(
                handle,
                err.message,
                err.stack,
                BigInt(attemptDuration),
                err.retryAfter !== undefined
                  ? BigInt(millisOrDurationToMillis(err.retryAfter))
                  : undefined,
                options?.maxRetryAttempts,
                options?.maxRetryDuration !== undefined
                  ? BigInt(millisOrDurationToMillis(options?.maxRetryDuration))
                  : undefined
              );
            } else if (err instanceof PauseError) {
              this.coreVm.propose_run_completion_failure_transient_with_pause(
                handle,
                err.message,
                err.stack,
                BigInt(attemptDuration)
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
                options?.maxRetryDuration !== undefined ||
                options?.maxRetryInterval !== undefined
              ) {
                retryPolicy = {
                  factor: options?.retryIntervalFactor ?? 2.0,
                  initial_interval: millisOrDurationToMillis(
                    options?.initialRetryInterval ?? 50
                  ),
                  max_attempts: options?.maxRetryAttempts,
                  max_duration:
                    options?.maxRetryDuration === undefined
                      ? undefined
                      : millisOrDurationToMillis(options?.maxRetryDuration),
                  max_interval: millisOrDurationToMillis(
                    options?.maxRetryInterval ?? { seconds: 10 }
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
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const serializedRes = serde.serialize(res);
            const encodedRes = this.journalValueCodec.encode(serializedRes);
            this.coreVm.propose_run_completion_success(handle, encodedRes);
          }
        } catch (e) {
          this.abortAttempt(e);
          return pendingPromise<T>();
        }
        await this.outputPump.awaitNextProgress();
      };

      // Register the run to execute
      this.runClosuresTracker.registerRunClosure(handle, doRun);
    }

    // TODO: here as well
    // Return the promise
    return new SingleRestatePromise(
      this,
      handle,
      completeUsing(
        { command: { type: WasmCommandType.Run, index: commandIndex } },
        SuccessWithSerde(serde, this.journalValueCodec),
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
            `Invalid negative sleep duration: ${millis}ms.\nIf this duration is computed from a desired wake up time, make sure to record 'now' using 'wakeUpTime - ctx.date.now()'.`
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
      this.abortAttempt(e);
      return {
        id: "invalid",
        promise: ConstRestatePromise.pending(),
      };
    }

    return {
      id: awakeable.id,
      promise: new SingleRestatePromise(
        this,
        awakeable.handle,
        completeUsing(
          {},
          VoidAsUndefined,
          SuccessWithSerde(serde ?? this.defaultSerde, this.journalValueCodec),
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
              ? this.defaultSerde.serialize(payload)
              : this.defaultSerde.serialize(null);
        }
        return this.journalValueCodec.encode(value);
      },
      (vm, bytes) => vm.sys_complete_awakeable_success(id, bytes)
    );
  }

  public rejectAwakeable(id: string, reason: string | TerminalError): void {
    this.processNonCompletableEntry(
      WasmCommandType.CompleteAwakeable,
      () => {},
      (vm) => {
        vm.sys_complete_awakeable_failure(id, toWasmFailure(reason));
      }
    );
  }

  // -- Signals

  public signal<T>(name: string, serde?: Serde<T>): RestatePromise<T> {
    let handle: number;
    try {
      handle = this.coreVm.sys_signal(name);
    } catch (e) {
      this.abortAttempt(e);
      return ConstRestatePromise.pending();
    }

    return new SingleRestatePromise(
      this,
      handle,
      completeUsing(
        {},
        VoidAsUndefined,
        SuccessWithSerde(serde ?? this.defaultSerde, this.journalValueCodec),
        Failure
      )
    );
  }

  public invocation(invocationId: InvocationId): InvocationReference {
    return new InvocationReferenceImpl(this, invocationId);
  }

  public promise<T>(name: string, serde?: Serde<T>): DurablePromise<T> {
    return new DurablePromiseImpl(this, name, serde);
  }

  cancellation(): RestatePromise<void> {
    if (!this.cancellationPromise || this.cancellationPromise.isCompleted()) {
      this.cancellationPromise = new SingleRestatePromise(
        this,
        1 /* HANDLE 1 is a hardcoded cancellation signal! */,
        completeUsing({}, VoidAsUndefined)
      );
    }

    return this.cancellationPromise;
  }

  cancelPreviousCalls(): RestatePromise<InvocationId[]> {
    if (!this.trackedInvocationIdPromises) {
      return ConstRestatePromise.resolve([]);
    }

    return CombinatorRestatePromise.fromPromises(
      "AllCompleted",
      (p: Promise<any>[]) => Promise.allSettled(p),
      this.trackedInvocationIdPromises.splice(0)
    ).map((results, failure) => {
      if (failure) {
        throw failure;
      }
      const cancelled: InvocationId[] = [];
      for (const result of results as PromiseSettledResult<string>[]) {
        if (result.status === "fulfilled") {
          this._cancel(result.value);
          cancelled.push(result.value as InvocationId);
        } else {
          this.console.warn(
            `Error when trying to get invocation id: ${result.reason}`
          );
        }
      }
      return cancelled;
    });
  }

  // -- Various private methods

  processNonCompletableEntry<T>(
    commandType: vm.WasmCommandType,
    prepare: () => T,
    vmCall: (vm: vm.WasmVM, input: T) => void
  ) {
    let input;
    try {
      input = prepare();
    } catch (e) {
      this.abortAttempt(e, commandType);
      return;
    }

    try {
      vmCall(this.coreVm, input);
    } catch (e) {
      this.abortAttempt(e);
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
      this.abortAttempt(e, commandType);
      return ConstRestatePromise.pending();
    }

    let handle: number;
    try {
      handle = vmCall(this.coreVm, input);
    } catch (e) {
      this.abortAttempt(e);
      return ConstRestatePromise.pending();
    }
    const commandIndex = this.coreVm.last_command_index();
    return new SingleRestatePromise(
      this,
      handle,
      completeUsing(
        {
          command: {
            type: commandType,
            index: commandIndex,
          },
        },
        ...completers
      )
    );
  }

  abortAttempt(e: unknown, commandType?: WasmCommandType) {
    // ensureError so interceptors always receive a proper Error,
    // not a raw VM object like { code, message }.
    this.invocationEndPromise.reject(
      commandType !== undefined
        ? new CommandError(e, commandType)
        : ensureError(e)
    );
  }
}

function toWasmFailure(reason: string | TerminalError): vm.WasmFailure {
  if (typeof reason === "string") {
    return {
      code: UNKNOWN_ERROR_CODE,
      message: reason,
      metadata: [],
    };
  }
  return {
    code: reason.code,
    message: reason.message,
    metadata: Object.entries(reason.metadata ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  };
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

class InvocationReferenceImpl implements InvocationReference {
  constructor(
    private readonly ctx: ContextImpl,
    private readonly invocationId: InvocationId
  ) {}

  signal<T>(name: string, serde?: Serde<T>): SignalReference<T> {
    return new SignalReferenceImpl(this.ctx, this.invocationId, name, serde);
  }

  cancel(): void {
    this.ctx.cancel(this.invocationId);
  }

  attach<T>(serde?: Serde<T>): RestatePromise<T> {
    return this.ctx.attach(this.invocationId, serde);
  }
}

class SignalReferenceImpl<T> implements SignalReference<T> {
  private readonly serde: Serde<T>;

  constructor(
    private readonly ctx: ContextImpl,
    private readonly invocationId: InvocationId,
    private readonly name: string,
    serde?: Serde<T>
  ) {
    this.serde = serde ?? (this.ctx.defaultSerde as unknown as Serde<T>);
  }

  resolve(payload?: T): void {
    this.ctx.processNonCompletableEntry(
      WasmCommandType.SendSignal,
      () =>
        this.ctx.journalValueCodec.encode(this.serde.serialize(payload as T)),
      (vm, bytes) =>
        vm.sys_complete_signal_success(this.invocationId, this.name, bytes)
    );
  }

  reject(reason: string | TerminalError): void {
    this.ctx.processNonCompletableEntry(
      WasmCommandType.SendSignal,
      () => {},
      (vm) => {
        vm.sys_complete_signal_failure(
          this.invocationId,
          this.name,
          toWasmFailure(reason)
        );
      }
    );
  }
}

class DurablePromiseImpl<T> implements DurablePromise<T> {
  private readonly serde: Serde<T>;

  constructor(
    private readonly ctx: ContextImpl,
    private readonly name: string,
    serde?: Serde<T>
  ) {
    this.serde = serde ?? (this.ctx.defaultSerde as unknown as Serde<T>);
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.get().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.get().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.get().finally(onfinally);
  }

  [Symbol.toStringTag] = "DurablePromise";

  get(): RestatePromise<T> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.GetPromise,
      () => {},
      (vm) => vm.sys_get_promise(this.name),
      SuccessWithSerde(this.serde, this.ctx.journalValueCodec),
      Failure
    );
  }

  peek(): Promise<T | undefined> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.PeekPromise,
      () => {},
      (vm) => vm.sys_peek_promise(this.name),
      VoidAsUndefined,
      SuccessWithSerde(this.serde, this.ctx.journalValueCodec),
      Failure
    );
  }

  resolve(value?: T): Promise<void> {
    return this.ctx.processCompletableEntry(
      WasmCommandType.CompletePromise,
      () => this.ctx.journalValueCodec.encode(this.serde.serialize(value as T)),
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
          metadata: [],
        }),
      VoidAsUndefined,
      Failure
    );
  }
}

/// Tracker of the promises of ephemeral commands, e.g. ephemeral state get, keyed by ephemeral completion id.
/// The promises are completed only by the PromisesExecutor loop, when the related ephemeral notification is ready.
export class EphemeralRequestTracker {
  private readonly pending = new Map<
    number,
    (value: AsyncResultValue) => Promise<void>
  >();

  constructor(private readonly channel: ExternalProgressChannel) {}

  register<T>(
    completionId: number,
    completer: (
      value: AsyncResultValue,
      prom: PromiseWithResolvers<T>
    ) => Promise<void>
  ): Promise<T> {
    const prom = Promise.withResolvers<T>();
    this.pending.set(completionId, async (value) => {
      try {
        await completer(value, prom);
      } catch (e) {
        // Ephemeral results are used within run closures, propagate the error there.
        prom.reject(e);
      }
    });
    // Wake up the progress loop: it will either pick up the notification, if the VM could answer it locally,
    // or flush the output containing the ephemeral command before waiting again for input.
    this.channel.signal();
    return prom.promise;
  }

  async complete(
    completionId: number,
    value: vm.WasmAsyncResultValue
  ): Promise<void> {
    const complete = this.pending.get(completionId);
    if (complete === undefined) {
      throw new Error(
        `Ephemeral request with completion id ${completionId} doesn't exist`
      );
    }
    if (value === "NotReady") {
      throw new Error(
        `Notification for ephemeral request with completion id ${completionId} is not ready. This is unexpected behavior.`
      );
    }
    this.pending.delete(completionId);
    await complete(value);
  }
}

/// Tracker of run closures to run
export class RunClosuresTracker {
  private runsToExecute: Map<number, () => Promise<any>> = new Map<
    number,
    () => Promise<any>
  >();

  constructor(private readonly channel: ExternalProgressChannel) {}

  executeRun(handle: number) {
    const runClosure = this.runsToExecute.get(handle);
    if (runClosure === undefined) {
      throw new Error(`Handle ${handle} doesn't exist`);
    }
    this.runsToExecute.delete(handle);
    runClosure()
      .finally(() => this.channel.signal())
      .catch(() => {});
  }

  registerRunClosure(handle: number, runClosure: () => Promise<any>) {
    this.runsToExecute.set(handle, runClosure);
  }
}

// ---- Functions used to parse async results

type Completer = (
  value: AsyncResultValue,
  prom: PromiseWithResolvers<any>
) => Promise<boolean>;

// Wraps an error with command metadata so the centralized catch in
// process() can call the right VM notification method.
//
// - Preparation failure (command not yet in journal): new CommandError(e, type)
//   → notify_error_for_next_command
// - Completion failure (command exists): new CommandError(e, type, index)
//   → notify_error_for_specific_command
export class CommandError extends Error {
  constructor(cause: unknown, commandType: WasmCommandType);
  constructor(
    cause: unknown,
    commandType: WasmCommandType,
    commandIndex: number
  );
  constructor(
    override readonly cause: unknown,
    readonly commandType: WasmCommandType,
    readonly commandIndex?: number
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(msg, { cause });
  }

  /** True when the error is for a specific command that exists in the journal. */
  get hasCommandIndex(): boolean {
    return this.commandIndex !== undefined;
  }
}

function completeUsing<T>(
  meta: {
    command?: {
      type: WasmCommandType;
      index: number;
    };
  },
  ...completers: Array<Completer>
): (value: AsyncResultValue, prom: PromiseWithResolvers<T>) => Promise<void> {
  return async (value: AsyncResultValue, prom: PromiseWithResolvers<any>) => {
    try {
      for (const completer of completers) {
        if (await completer(value, prom)) {
          return;
        }
      }
    } catch (e) {
      if (meta.command !== undefined) {
        throw new CommandError(e, meta.command.type, meta.command.index);
      }
      // No meta to use for decoration
      throw e;
    }

    throw new Error(
      `Unexpected variant in async result: ${JSON.stringify(value)}`
    );
  };
}

const VoidAsNull: Completer = (value, prom) => {
  if (value === "Empty") {
    prom.resolve(null);
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
};
const VoidAsUndefined: Completer = (value, prom) => {
  if (value === "Empty") {
    prom.resolve(undefined);
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
};

function SuccessWithSerde<T>(
  serde: Serde<T>,
  journalCodec?: JournalValueCodec,
  transform?: <U>(success: T) => U
): Completer {
  return async (value, prom) => {
    if (typeof value !== "object" || !("Success" in value)) {
      return false;
    }
    let buffer: Uint8Array;
    if (journalCodec !== undefined) {
      buffer = await journalCodec.decode(value.Success);
    } else {
      buffer = value.Success;
    }
    let val = serde.deserialize(buffer);
    if (transform) {
      val = transform(val);
    }
    prom.resolve(val);
    return true;
  };
}

const Failure: Completer = (value, prom) => {
  if (typeof value === "object" && "Failure" in value) {
    const metadata = (value.Failure.metadata ?? []).reduce(
      (
        acc: Record<string, string>,
        { key, value: v }: { key: string; value: string }
      ) => {
        acc[key] = v;
        return acc;
      },
      {} as Record<string, string>
    );
    prom.reject(
      new TerminalError(value.Failure.message, {
        errorCode: value.Failure.code,
        metadata,
      })
    );
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
};

const StateKeys: Completer = (value, prom) => {
  if (typeof value === "object" && "StateKeys" in value) {
    prom.resolve(value.StateKeys);
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
};

const InvocationIdCompleter: Completer = (value, prom) => {
  if (typeof value === "object" && "InvocationId" in value) {
    prom.resolve(value.InvocationId);
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
};
