/* tslint:disable */
/* eslint-disable */
/**
* Setups the WASM module
*/
export function start(): void;
/**
* This will set the log level of the overall log subscriber.
* @param {LogLevel} level
*/
export function set_log_level(level: LogLevel): void;
/**
*/
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}
export interface WasmFailure {
    code: number;
    message: string;
}

export type WasmSendHandle = number;

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

export type WasmAsyncResultValue = "NotReady" | "Empty" | { Success: Uint8Array } | { Failure: WasmFailure } | { StateKeys: string[] } | { InvocationId: string } | { CombinatorResult: WasmAsyncResultHandle[] };

export type WasmRunEnterResult = { ExecutedWithSuccess: Uint8Array } | { ExecutedWithFailure: WasmFailure } | "NotExecuted";

/**
*/
export class WasmHeader {
  free(): void;
/**
* @param {string} key
* @param {string} value
*/
  constructor(key: string, value: string);
/**
*/
  readonly key: string;
/**
*/
  readonly value: string;
}
/**
*/
export class WasmIdentityVerifier {
  free(): void;
/**
* @param {(string)[]} keys
*/
  constructor(keys: (string)[]);
/**
* @param {string} path
* @param {(WasmHeader)[]} headers
*/
  verify_identity(path: string, headers: (WasmHeader)[]): void;
}
/**
*/
export class WasmInput {
  free(): void;
/**
*/
  readonly headers: (WasmHeader)[];
/**
*/
  readonly input: Uint8Array;
/**
*/
  readonly invocation_id: string;
/**
*/
  readonly key: string;
}
/**
*/
export class WasmResponseHead {
  free(): void;
/**
*/
  readonly headers: (WasmHeader)[];
/**
*/
  readonly status_code: number;
}
/**
*/
export class WasmVM {
  free(): void;
/**
* @param {(WasmHeader)[]} headers
* @param {LogLevel} log_level
* @param {number} logger_id
*/
  constructor(headers: (WasmHeader)[], log_level: LogLevel, logger_id: number);
/**
* @returns {WasmResponseHead}
*/
  get_response_head(): WasmResponseHead;
/**
* @param {Uint8Array} buffer
*/
  notify_input(buffer: Uint8Array): void;
/**
*/
  notify_input_closed(): void;
/**
* @param {string} error_message
* @param {string | undefined} [error_description]
*/
  notify_error(error_message: string, error_description?: string): void;
/**
* @returns {any}
*/
  take_output(): any;
/**
* @returns {boolean}
*/
  is_ready_to_execute(): boolean;
/**
* @param {number} handle
*/
  notify_await_point(handle: number): void;
/**
* @param {number} handle
* @returns {WasmAsyncResultValue}
*/
  take_async_result(handle: number): WasmAsyncResultValue;
/**
* @returns {WasmInput}
*/
  sys_input(): WasmInput;
/**
* @param {string} key
* @returns {number}
*/
  sys_get_state(key: string): number;
/**
* @returns {number}
*/
  sys_get_state_keys(): number;
/**
* @param {string} key
* @param {Uint8Array} buffer
*/
  sys_set_state(key: string, buffer: Uint8Array): void;
/**
* @param {string} key
*/
  sys_clear_state(key: string): void;
/**
*/
  sys_clear_all_state(): void;
/**
* @param {bigint} millis
* @returns {number}
*/
  sys_sleep(millis: bigint): number;
/**
* @param {string} service
* @param {string} handler
* @param {Uint8Array} buffer
* @param {string | undefined} key
* @param {(WasmHeader)[]} headers
* @returns {number}
*/
  sys_call(service: string, handler: string, buffer: Uint8Array, key: string | undefined, headers: (WasmHeader)[]): number;
/**
* @param {string} service
* @param {string} handler
* @param {Uint8Array} buffer
* @param {string | undefined} key
* @param {(WasmHeader)[]} headers
* @param {bigint | undefined} [delay]
* @returns {WasmSendHandle}
*/
  sys_send(service: string, handler: string, buffer: Uint8Array, key: string | undefined, headers: (WasmHeader)[], delay?: bigint): WasmSendHandle;
/**
* @returns {WasmAwakeable}
*/
  sys_awakeable(): WasmAwakeable;
/**
* @param {string} id
* @param {Uint8Array} buffer
*/
  sys_complete_awakeable_success(id: string, buffer: Uint8Array): void;
/**
* @param {string} id
* @param {WasmFailure} value
*/
  sys_complete_awakeable_failure(id: string, value: WasmFailure): void;
/**
* @param {string} key
* @returns {number}
*/
  sys_get_promise(key: string): number;
/**
* @param {string} key
* @returns {number}
*/
  sys_peek_promise(key: string): number;
/**
* @param {string} key
* @param {Uint8Array} buffer
* @returns {number}
*/
  sys_complete_promise_success(key: string, buffer: Uint8Array): number;
/**
* @param {string} key
* @param {WasmFailure} value
* @returns {number}
*/
  sys_complete_promise_failure(key: string, value: WasmFailure): number;
/**
* @param {string} name
* @returns {WasmRunEnterResult}
*/
  sys_run_enter(name: string): WasmRunEnterResult;
/**
* @param {Uint8Array} buffer
* @returns {number}
*/
  sys_run_exit_success(buffer: Uint8Array): number;
/**
* @param {WasmFailure} value
* @returns {number}
*/
  sys_run_exit_failure(value: WasmFailure): number;
/**
* @param {string} error_message
* @param {string | undefined} error_description
* @param {bigint} attempt_duration
* @param {WasmExponentialRetryConfig} config
* @returns {number}
*/
  sys_run_exit_failure_transient(error_message: string, error_description: string | undefined, attempt_duration: bigint, config: WasmExponentialRetryConfig): number;
/**
* @param {Uint8Array} buffer
*/
  sys_write_output_success(buffer: Uint8Array): void;
/**
* @param {WasmFailure} value
*/
  sys_write_output_failure(value: WasmFailure): void;
/**
*/
  sys_end(): void;
/**
* @returns {boolean}
*/
  is_processing(): boolean;
/**
* @returns {boolean}
*/
  is_inside_run(): boolean;
/**
* @param {Uint32Array} handles
* @returns {number | undefined}
*/
  sys_try_complete_all_combinator(handles: Uint32Array): number | undefined;
/**
* @param {Uint32Array} handles
* @returns {number | undefined}
*/
  sys_try_complete_any_combinator(handles: Uint32Array): number | undefined;
/**
* @param {Uint32Array} handles
* @returns {number | undefined}
*/
  sys_try_complete_all_settled_combinator(handles: Uint32Array): number | undefined;
/**
* @param {Uint32Array} handles
* @returns {number | undefined}
*/
  sys_try_complete_race_combinator(handles: Uint32Array): number | undefined;
}
