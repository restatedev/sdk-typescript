/* tslint:disable */
/* eslint-disable */
/**
 * Setups the WASM module
 */
export function start(): void;
/**
 * This will set the log level of the overall log subscriber.
 */
export function set_log_level(level: LogLevel): void;
export function cancel_handle(): number;
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
}
export interface WasmFailure {
  code: number;
  message: string;
}

export interface WasmExponentialRetryConfig {
  initial_interval: number | undefined;
  factor: number;
  max_interval: number | undefined;
  max_attempts: number | undefined;
  max_duration: number | undefined;
}

export interface WasmAwakeable {
  id: string;
  handle: number;
}

export type WasmAsyncResultValue =
  | "NotReady"
  | "Empty"
  | { Success: Uint8Array }
  | { Failure: WasmFailure }
  | { StateKeys: string[] }
  | { InvocationId: string };

export type WasmDoProgressResult =
  | "AnyCompleted"
  | "ReadFromInput"
  | "WaitingPendingRun"
  | { ExecuteRun: number }
  | "CancelSignalReceived";

export interface WasmCallHandle {
  invocation_id_completion_id: number;
  call_completion_id: number;
}

export interface WasmSendHandle {
  invocation_id_completion_id: number;
}

export class WasmHeader {
  free(): void;
  constructor(key: string, value: string);
  readonly key: string;
  readonly value: string;
}
export class WasmIdentityVerifier {
  free(): void;
  constructor(keys: string[]);
  verify_identity(path: string, headers: WasmHeader[]): void;
}
export class WasmInput {
  private constructor();
  free(): void;
  readonly invocation_id: string;
  readonly key: string;
  readonly headers: WasmHeader[];
  readonly input: Uint8Array;
}
export class WasmResponseHead {
  private constructor();
  free(): void;
  readonly status_code: number;
  readonly headers: WasmHeader[];
}
export class WasmVM {
  free(): void;
  constructor(headers: WasmHeader[], log_level: LogLevel, logger_id: number);
  get_response_head(): WasmResponseHead;
  notify_input(buffer: Uint8Array): void;
  notify_input_closed(): void;
  notify_error(error_message: string, stacktrace?: string | null): void;
  take_output(): any;
  is_ready_to_execute(): boolean;
  is_completed(handle: number): boolean;
  do_progress(handles: Uint32Array): WasmDoProgressResult;
  take_notification(handle: number): WasmAsyncResultValue;
  sys_input(): WasmInput;
  sys_get_state(key: string): number;
  sys_get_state_keys(): number;
  sys_set_state(key: string, buffer: Uint8Array): void;
  sys_clear_state(key: string): void;
  sys_clear_all_state(): void;
  sys_sleep(millis: bigint): number;
  sys_attach_invocation(invocation_id: string): number;
  sys_get_invocation_output(invocation_id: string): number;
  sys_call(
    service: string,
    handler: string,
    buffer: Uint8Array,
    key: string | null | undefined,
    headers: WasmHeader[],
    idempotency_key?: string | null
  ): WasmCallHandle;
  sys_send(
    service: string,
    handler: string,
    buffer: Uint8Array,
    key: string | null | undefined,
    headers: WasmHeader[],
    delay?: bigint | null,
    idempotency_key?: string | null
  ): WasmSendHandle;
  sys_awakeable(): WasmAwakeable;
  sys_complete_awakeable_success(id: string, buffer: Uint8Array): void;
  sys_complete_awakeable_failure(id: string, value: WasmFailure): void;
  sys_get_promise(key: string): number;
  sys_peek_promise(key: string): number;
  sys_complete_promise_success(key: string, buffer: Uint8Array): number;
  sys_complete_promise_failure(key: string, value: WasmFailure): number;
  sys_run(name: string): number;
  propose_run_completion_success(handle: number, buffer: Uint8Array): void;
  propose_run_completion_failure(handle: number, value: WasmFailure): void;
  propose_run_completion_failure_transient(
    handle: number,
    error_message: string,
    error_stacktrace: string | null | undefined,
    attempt_duration: bigint,
    config: WasmExponentialRetryConfig
  ): void;
  sys_cancel_invocation(target_invocation_id: string): void;
  sys_write_output_success(buffer: Uint8Array): void;
  sys_write_output_failure(value: WasmFailure): void;
  sys_end(): void;
  is_processing(): boolean;
}
