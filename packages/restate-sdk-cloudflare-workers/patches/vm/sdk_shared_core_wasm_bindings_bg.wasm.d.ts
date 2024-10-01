/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export function start(): void;
export function set_log_level(a: number): void;
export function __wbg_wasmheader_free(a: number, b: number): void;
export function __wbg_get_wasmheader_key(a: number, b: number): void;
export function __wbg_get_wasmheader_value(a: number, b: number): void;
export function wasmheader_new(a: number, b: number, c: number, d: number): number;
export function __wbg_wasmresponsehead_free(a: number, b: number): void;
export function __wbg_get_wasmresponsehead_status_code(a: number): number;
export function __wbg_get_wasmresponsehead_headers(a: number, b: number): void;
export function __wbg_wasminput_free(a: number, b: number): void;
export function __wbg_get_wasminput_headers(a: number, b: number): void;
export function __wbg_get_wasminput_input(a: number): number;
export function __wbg_wasmvm_free(a: number, b: number): void;
export function wasmvm_new(a: number, b: number, c: number): void;
export function wasmvm_get_response_head(a: number): number;
export function wasmvm_notify_input(a: number, b: number, c: number): void;
export function wasmvm_notify_input_closed(a: number): void;
export function wasmvm_notify_error(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_take_output(a: number): number;
export function wasmvm_is_ready_to_execute(a: number, b: number): void;
export function wasmvm_notify_await_point(a: number, b: number): void;
export function wasmvm_take_async_result(a: number, b: number, c: number): void;
export function wasmvm_sys_input(a: number, b: number): void;
export function wasmvm_sys_get_state(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_get_state_keys(a: number, b: number): void;
export function wasmvm_sys_set_state(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_clear_state(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_clear_all_state(a: number, b: number): void;
export function wasmvm_sys_sleep(a: number, b: number, c: number): void;
export function wasmvm_sys_call(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): void;
export function wasmvm_sys_send(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): void;
export function wasmvm_sys_awakeable(a: number, b: number): void;
export function wasmvm_sys_complete_awakeable_success(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_complete_awakeable_failure(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_get_promise(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_peek_promise(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_complete_promise_success(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_complete_promise_failure(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_run_enter(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_run_exit_success(a: number, b: number, c: number): void;
export function wasmvm_sys_run_exit_failure(a: number, b: number, c: number): void;
export function wasmvm_sys_run_exit_failure_transient(a: number, b: number, c: number, d: number, e: number): void;
export function wasmvm_sys_write_output_success(a: number, b: number, c: number): void;
export function wasmvm_sys_write_output_failure(a: number, b: number, c: number): void;
export function wasmvm_sys_end(a: number, b: number): void;
export function wasmvm_is_processing(a: number): number;
export function wasmvm_is_inside_run(a: number): number;
export function wasmvm_sys_try_complete_all_combinator(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_try_complete_any_combinator(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_try_complete_all_settled_combinator(a: number, b: number, c: number, d: number): void;
export function wasmvm_sys_try_complete_race_combinator(a: number, b: number, c: number, d: number): void;
export function __wbg_get_wasminput_invocation_id(a: number, b: number): void;
export function __wbg_get_wasminput_key(a: number, b: number): void;
export function __wbindgen_malloc(a: number, b: number): number;
export function __wbindgen_realloc(a: number, b: number, c: number, d: number): number;
export function __wbindgen_add_to_stack_pointer(a: number): number;
export function __wbindgen_free(a: number, b: number, c: number): void;
export function __wbindgen_start(): void;
