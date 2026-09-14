/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/**
 * Exposes the TypeScript shared core with the same surface as the WASM
 * bindings (`sdk-shared-core-wasm-bindings/src/lib.rs`).
 */

import {
  LogLevel,
  WasmCommandType,
  WasmJournalMismatchBehavior,
  type SharedCoreBindings,
  type WasmAsyncResultValue,
  type WasmAwakeable,
  type WasmCallHandle,
  type WasmDoProgressResult,
  type WasmExponentialRetryConfig,
  type WasmFailure,
  type WasmHeader,
  type WasmInput,
  type WasmResponseHead,
  type WasmRun,
  type WasmSendHandle,
  type WasmUnresolvedFuture,
  type WasmVM,
} from "../types.js";
import { VMError } from "./errors.js";
import { IdentityVerifier } from "./identity.js";
import {
  OnMaxAttempts,
  RETRY_POLICY_INFINITE,
  RETRY_POLICY_NONE,
  type RetryPolicy,
} from "./retries.js";
import {
  CANCEL_NOTIFICATION_HANDLE,
  JournalMismatchRetryBehavior,
  NonDeterministicChecksOption,
  VMState,
  type AwaitResponse,
  type CommandRelationship,
  type VMOptions,
} from "./types.js";
import { CoreVM, type CoreLogger } from "./vm.js";
import { AwaitingOnPolicy } from "./types.js";

/** Sink for the shared core log records. */
export type LogSink = (
  level: LogLevel,
  message: string,
  loggerId: number | undefined
) => void;

let globalLogLevel: LogLevel = LogLevel.INFO;
let globalLogSink: LogSink = () => {};

/** Installs the log sink used by the TypeScript shared core. */
export function setLogSink(sink: LogSink) {
  globalLogSink = sink;
}

export function set_log_level(level: LogLevel) {
  globalLogLevel = level;
}

export function cancel_handle(): number {
  return CANCEL_NOTIFICATION_HANDLE;
}

function makeLogger(level: LogLevel, loggerId: number | undefined): CoreLogger {
  return {
    enabled: (l) => l >= level,
    log: (l, message) => {
      if (l >= level) {
        globalLogSink(l, message, loggerId);
      }
    },
  };
}

/** Converts a VM error into the shape thrown by the WASM bindings. */
function toWasmFailure(e: VMError): WasmFailure {
  return {
    code: e.code,
    message: e.toString(),
    metadata: [],
  };
}

/** Runs `f`, converting VM errors into thrown `WasmFailure` objects. */
function wrap<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof VMError) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw toWasmFailure(e);
    }
    throw e;
  }
}

function makeError(message: string, stacktrace?: string | null): VMError {
  const e = VMError.internal(message);
  if (stacktrace !== undefined && stacktrace !== null) {
    e.withStacktrace(stacktrace);
  }
  return e;
}

function awaitResponseToWasm(r: AwaitResponse): WasmDoProgressResult {
  switch (r.type) {
    case "anyCompleted":
      return "AnyCompleted";
    case "waitingExternalProgress":
      return "WaitExternalProgress";
    case "executeRun":
      return { ExecuteRun: r.handle };
    case "cancelSignalReceived":
      return "CancelSignalReceived";
  }
}

function exponentialRetryConfigToPolicy(
  config: WasmExponentialRetryConfig
): RetryPolicy {
  return {
    type: "exponential",
    initialInterval: config.initial_interval ?? 10,
    maxAttempts: config.max_attempts,
    maxDuration: config.max_duration,
    factor: config.factor,
    maxInterval: config.max_interval,
    onMaxAttempts: OnMaxAttempts.FailAsTerminal,
  };
}

function nowSinceUnixEpoch(): bigint {
  return BigInt(Date.now());
}

export class TsHeader implements WasmHeader {
  constructor(
    readonly key: string,
    readonly value: string
  ) {}
}

export class TsVM implements WasmVM {
  private readonly vm: CoreVM;

  constructor(
    headers: WasmHeader[],
    log_level: LogLevel,
    logger_id: number,
    disable_payload_checks: boolean,
    explicit_cancellation: boolean,
    on_journal_mismatch: WasmJournalMismatchBehavior
  ) {
    const options: VMOptions = {
      nonDeterminismChecks: disable_payload_checks
        ? NonDeterministicChecksOption.PayloadChecksDisabled
        : NonDeterministicChecksOption.Enabled,
      implicitCancellation: explicit_cancellation
        ? { type: "disabled" }
        : {
            type: "enabled",
            cancelChildrenCalls: true,
            cancelChildrenOneWayCalls: false,
          },
      awaitingOnPolicy: AwaitingOnPolicy.DontSendWhenExecutingRun,
      journalMismatchRetryBehavior:
        journalMismatchBehaviorToCore(on_journal_mismatch),
    };
    this.vm = wrap(
      () => new CoreVM(headers, options, makeLogger(log_level, logger_id))
    );
  }

  get_response_head(): WasmResponseHead {
    const head = this.vm.getResponseHead();
    return { status_code: head.statusCode, headers: head.headers };
  }

  notify_input(buffer: Uint8Array): void {
    this.vm.notifyInput(buffer);
  }

  notify_input_closed(): void {
    this.vm.notifyInputClosed();
  }

  notify_error(error_message: string, stacktrace?: string | null): void {
    this.vm.notifyError(makeError(error_message, stacktrace), undefined);
  }

  notify_error_with_delay_override(
    error_message: string,
    stacktrace?: string | null,
    delay_override?: bigint | null
  ): void {
    const e = makeError(error_message, stacktrace);
    if (delay_override !== undefined && delay_override !== null) {
      e.withNextRetryDelayOverride(Number(delay_override));
    }
    this.vm.notifyError(e, undefined);
  }

  notify_error_for_next_command(
    error_message: string,
    stacktrace: string | null | undefined,
    wasm_command_type: WasmCommandType
  ): void {
    const relationship: CommandRelationship = {
      type: "next",
      ty: wasm_command_type,
      name: undefined,
    };
    this.vm.notifyError(makeError(error_message, stacktrace), relationship);
  }

  notify_error_for_specific_command(
    error_message: string,
    stacktrace: string | null | undefined,
    wasm_command_type: WasmCommandType,
    command_index: number,
    command_name?: string | null
  ): void {
    const relationship: CommandRelationship = {
      type: "specific",
      commandIndex: command_index,
      ty: wasm_command_type,
      name: command_name ?? undefined,
    };
    this.vm.notifyError(makeError(error_message, stacktrace), relationship);
  }

  take_output(): Uint8Array {
    return this.vm.takeOutput();
  }

  is_ready_to_execute(): boolean {
    return wrap(() => this.vm.isReadyToExecute());
  }

  is_completed(handle: number): boolean {
    return this.vm.isCompleted(handle);
  }

  do_progress(future: WasmUnresolvedFuture): WasmDoProgressResult {
    return wrap(() => awaitResponseToWasm(this.vm.doAwait(future)));
  }

  take_notification(handle: number): WasmAsyncResultValue {
    return wrap(() => this.vm.takeNotification(handle) ?? "NotReady");
  }

  // Syscall(s)

  sys_input(): WasmInput {
    return wrap(() => {
      const input = this.vm.sysInput();
      return {
        invocation_id: input.invocationId,
        key: input.key,
        idempotency_key: input.idempotencyKey,
        scope: input.scope,
        limit_key: input.limitKey,
        headers: input.headers,
        input: input.input,
        random_seed: input.randomSeed,
      };
    });
  }

  sys_get_state(key: string): number {
    return wrap(() => this.vm.sysStateGet(key));
  }

  sys_get_state_keys(): number {
    return wrap(() => this.vm.sysStateGetKeys());
  }

  sys_set_state(key: string, buffer: Uint8Array): void {
    wrap(() => this.vm.sysStateSet(key, buffer));
  }

  sys_clear_state(key: string): void {
    wrap(() => this.vm.sysStateClear(key));
  }

  sys_clear_all_state(): void {
    wrap(() => this.vm.sysStateClearAll());
  }

  sys_sleep(millis: bigint, name?: string | null): number {
    const now = nowSinceUnixEpoch();
    return wrap(() => this.vm.sysSleep(name ?? "", now + millis, now));
  }

  sys_attach_invocation(invocation_id: string): number {
    return wrap(() =>
      this.vm.sysAttachInvocation({ type: "invocationId", id: invocation_id })
    );
  }

  sys_get_invocation_output(invocation_id: string): number {
    return wrap(() =>
      this.vm.sysGetInvocationOutput({
        type: "invocationId",
        id: invocation_id,
      })
    );
  }

  sys_call(
    service: string,
    handler: string,
    buffer: Uint8Array,
    key: string | null | undefined,
    headers: WasmHeader[],
    idempotency_key?: string | null,
    scope?: string | null,
    limit_key?: string | null,
    name?: string | null
  ): WasmCallHandle {
    return wrap(() => {
      const handle = this.vm.sysCall(
        {
          service,
          handler,
          key: key ?? undefined,
          idempotencyKey: idempotency_key ?? undefined,
          scope: scope ?? undefined,
          limitKey: limit_key ?? undefined,
          headers,
        },
        buffer,
        name ?? undefined
      );
      return {
        invocation_id_completion_id: handle.invocationIdNotificationHandle,
        call_completion_id: handle.callNotificationHandle,
      };
    });
  }

  sys_send(
    service: string,
    handler: string,
    buffer: Uint8Array,
    key: string | null | undefined,
    headers: WasmHeader[],
    delay?: bigint | null,
    idempotency_key?: string | null,
    scope?: string | null,
    limit_key?: string | null,
    name?: string | null
  ): WasmSendHandle {
    return wrap(() => {
      const handle = this.vm.sysSend(
        {
          service,
          handler,
          key: key ?? undefined,
          idempotencyKey: idempotency_key ?? undefined,
          scope: scope ?? undefined,
          limitKey: limit_key ?? undefined,
          headers,
        },
        buffer,
        delay !== undefined && delay !== null
          ? nowSinceUnixEpoch() + delay
          : undefined,
        name ?? undefined
      );
      return {
        invocation_id_completion_id: handle.invocationIdNotificationHandle,
      };
    });
  }

  sys_awakeable(): WasmAwakeable {
    return wrap(() => this.vm.sysAwakeable());
  }

  sys_complete_awakeable_success(id: string, buffer: Uint8Array): void {
    wrap(() =>
      this.vm.sysCompleteAwakeable(id, { type: "success", value: buffer })
    );
  }

  sys_complete_awakeable_failure(id: string, value: WasmFailure): void {
    wrap(() =>
      this.vm.sysCompleteAwakeable(id, { type: "failure", failure: value })
    );
  }

  sys_signal(signal_name: string): number {
    return wrap(() => this.vm.createSignalHandle(signal_name));
  }

  sys_complete_signal_success(
    invocation_id: string,
    signal_name: string,
    buffer: Uint8Array
  ): void {
    wrap(() =>
      this.vm.sysCompleteSignal(invocation_id, signal_name, {
        type: "success",
        value: buffer,
      })
    );
  }

  sys_complete_signal_failure(
    invocation_id: string,
    signal_name: string,
    value: WasmFailure
  ): void {
    wrap(() =>
      this.vm.sysCompleteSignal(invocation_id, signal_name, {
        type: "failure",
        failure: value,
      })
    );
  }

  sys_get_promise(key: string): number {
    return wrap(() => this.vm.sysGetPromise(key));
  }

  sys_peek_promise(key: string): number {
    return wrap(() => this.vm.sysPeekPromise(key));
  }

  sys_complete_promise_success(key: string, buffer: Uint8Array): number {
    return wrap(() =>
      this.vm.sysCompletePromise(key, { type: "success", value: buffer })
    );
  }

  sys_complete_promise_failure(key: string, value: WasmFailure): number {
    return wrap(() =>
      this.vm.sysCompletePromise(key, { type: "failure", failure: value })
    );
  }

  sys_run(name: string): WasmRun {
    return wrap(() => this.vm.sysRun(name));
  }

  propose_run_completion_success(handle: number, buffer: Uint8Array): void {
    wrap(() =>
      this.vm.proposeRunCompletion(
        handle,
        { type: "success", value: buffer },
        RETRY_POLICY_NONE
      )
    );
  }

  propose_run_completion_failure(handle: number, value: WasmFailure): void {
    wrap(() =>
      this.vm.proposeRunCompletion(
        handle,
        { type: "terminalFailure", failure: value },
        RETRY_POLICY_NONE
      )
    );
  }

  propose_run_completion_failure_transient(
    handle: number,
    error_message: string,
    error_stacktrace: string | null | undefined,
    attempt_duration: bigint,
    config?: WasmExponentialRetryConfig | null
  ): void {
    wrap(() =>
      this.vm.proposeRunCompletion(
        handle,
        {
          type: "retryableFailure",
          attemptDuration: Number(attempt_duration),
          error: VMError.internal(error_message).withStacktrace(
            error_stacktrace ?? ""
          ),
        },
        config !== undefined && config !== null
          ? exponentialRetryConfigToPolicy(config)
          : RETRY_POLICY_INFINITE
      )
    );
  }

  propose_run_completion_failure_transient_with_delay_override(
    handle: number,
    error_message: string,
    error_stacktrace: string | null | undefined,
    attempt_duration: bigint,
    delay_override?: bigint | null,
    max_retry_attempts_override?: number | null,
    max_retry_duration_override?: bigint | null
  ): void {
    const hasDelay = delay_override !== undefined && delay_override !== null;
    const hasMaxAttempts =
      max_retry_attempts_override !== undefined &&
      max_retry_attempts_override !== null;
    const hasMaxDuration =
      max_retry_duration_override !== undefined &&
      max_retry_duration_override !== null;
    const retryPolicy: RetryPolicy =
      hasDelay || hasMaxAttempts || hasMaxDuration
        ? {
            type: "fixedDelay",
            interval: hasDelay ? Number(delay_override) : undefined,
            maxAttempts: hasMaxAttempts
              ? max_retry_attempts_override
              : undefined,
            maxDuration: hasMaxDuration
              ? Number(max_retry_duration_override)
              : undefined,
            onMaxAttempts: OnMaxAttempts.FailAsTerminal,
          }
        : RETRY_POLICY_INFINITE;
    wrap(() =>
      this.vm.proposeRunCompletion(
        handle,
        {
          type: "retryableFailure",
          attemptDuration: Number(attempt_duration),
          error: VMError.internal(error_message).withStacktrace(
            error_stacktrace ?? ""
          ),
        },
        retryPolicy
      )
    );
  }

  propose_run_completion_failure_transient_with_pause(
    handle: number,
    error_message: string,
    error_stacktrace: string | null | undefined,
    attempt_duration: bigint
  ): void {
    wrap(() =>
      this.vm.proposeRunCompletion(
        handle,
        {
          type: "retryableFailure",
          attemptDuration: Number(attempt_duration),
          error: VMError.internal(error_message)
            .withStacktrace(error_stacktrace ?? "")
            .withShouldPause(true),
        },
        RETRY_POLICY_INFINITE
      )
    );
  }

  sys_cancel_invocation(target_invocation_id: string): void {
    wrap(() => this.vm.sysCancelInvocation(target_invocation_id));
  }

  sys_write_output_success(buffer: Uint8Array): void {
    wrap(() => this.vm.sysWriteOutput({ type: "success", value: buffer }));
  }

  sys_write_output_failure(value: WasmFailure): void {
    wrap(() => this.vm.sysWriteOutput({ type: "failure", failure: value }));
  }

  sys_end(): void {
    wrap(() => this.vm.sysEnd());
  }

  is_processing(): boolean {
    return this.vm.state() === VMState.Processing;
  }

  last_command_index(): number {
    return this.vm.lastCommandIndex();
  }
}

function journalMismatchBehaviorToCore(
  b: WasmJournalMismatchBehavior
): JournalMismatchRetryBehavior {
  switch (b) {
    case WasmJournalMismatchBehavior.Retry:
      return JournalMismatchRetryBehavior.FollowRetryPolicy;
    case WasmJournalMismatchBehavior.Pause:
      return JournalMismatchRetryBehavior.Pause;
    case WasmJournalMismatchBehavior.Fail:
      return JournalMismatchRetryBehavior.FailTerminally;
  }
}

export const tsBindings: SharedCoreBindings = {
  kind: "ts",
  WasmVM: TsVM,
  WasmHeader: TsHeader,
  WasmIdentityVerifier: IdentityVerifier,
  set_log_level,
  cancel_handle,
};

// Re-exported so that the global log level is observable by the selector
export function currentLogLevel(): LogLevel {
  return globalLogLevel;
}
