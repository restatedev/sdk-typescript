use js_sys::Uint8Array;
use restate_sdk_shared_core::{
    AsyncResultAccessTracker, AsyncResultCombinator, AsyncResultHandle, AsyncResultState, CoreVM,
    Error, Header, HeaderMap, Input, NonEmptyValue, ResponseHead, RetryPolicy, RunEnterResult,
    RunExitResult, TakeOutputResult, Target, TerminalFailure, VMOptions, Value, VM,
};
use serde::{Deserialize, Serialize};
use std::convert::{Infallible, Into};
use std::io::Write;
use std::time::Duration;
use tracing::metadata::LevelFilter;
use tracing::Level;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

/// Setups the WASM module
#[wasm_bindgen(start)]
pub fn start() {
    // print pretty errors in wasm https://github.com/rustwasm/console_error_panic_hook
    // This is not needed for tracing_wasm to work, but it is a common tool for getting proper error line numbers for panics.
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
}

#[wasm_bindgen(raw_module = "../generic.js")]
extern "C" {
    #[wasm_bindgen]
    fn vm_log(level: LogLevel, s: &str);
}

pub struct MakeWebConsoleWriter {}

impl Default for MakeWebConsoleWriter {
    fn default() -> Self {
        MakeWebConsoleWriter {}
    }
}

impl<'a> MakeWriter<'a> for MakeWebConsoleWriter {
    type Writer = ConsoleWriter;

    fn make_writer(&'a self) -> Self::Writer {
        ConsoleWriter {
            buffer: vec![],
            level: Level::TRACE, // if no level is known, assume the most detailed
        }
    }

    fn make_writer_for(&'a self, meta: &tracing::Metadata<'_>) -> Self::Writer {
        let level = *meta.level();
        ConsoleWriter {
            buffer: vec![],
            level,
        }
    }
}

pub struct ConsoleWriter {
    buffer: Vec<u8>,
    level: Level,
}

impl Write for ConsoleWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for ConsoleWriter {
    fn drop(&mut self) {
        // TODO: it's rather pointless to decoded to utf-8 here,
        //  just to re-encode as utf-16 when crossing wasm-bindgen boundaries
        // we could use TextDecoder directly to produce a
        let message = String::from_utf8_lossy(&self.buffer);
        vm_log(
            match self.level {
                Level::TRACE => LogLevel::TRACE,
                Level::DEBUG => LogLevel::DEBUG,
                Level::INFO => LogLevel::INFO,
                Level::WARN => LogLevel::WARN,
                Level::ERROR => LogLevel::ERROR,
            },
            message.as_ref(),
        )
    }
}

#[wasm_bindgen]
pub fn set_log_level(level: LogLevel) {
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .without_time()
        .with_thread_names(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .with_target(true)
        .with_level(false)
        .with_writer(MakeWebConsoleWriter::default())
        // We do filtering here too,
        // as it might get expensive to pass logs through
        // the various layers even though we don't need them
        .with_filter(LevelFilter::from_level(match level {
            LogLevel::TRACE => Level::TRACE,
            LogLevel::DEBUG => Level::DEBUG,
            LogLevel::INFO => Level::INFO,
            LogLevel::WARN => Level::WARN,
            LogLevel::ERROR => Level::ERROR,
        }));

    let _ = tracing::subscriber::set_global_default(Registry::default().with(fmt_layer));
}

// Data model

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct WasmHeader {
    #[wasm_bindgen(readonly)]
    pub key: String,
    #[wasm_bindgen(readonly)]
    pub value: String,
}
#[wasm_bindgen]
impl WasmHeader {
    #[wasm_bindgen(constructor)]
    pub fn new(key: String, value: String) -> WasmHeader {
        WasmHeader { key, value }
    }
}

impl From<Header> for WasmHeader {
    fn from(h: Header) -> Self {
        WasmHeader {
            key: h.key.into(),
            value: h.value.into(),
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmResponseHead {
    #[wasm_bindgen(readonly)]
    pub status_code: u16,
    #[wasm_bindgen(readonly)]
    pub headers: Vec<WasmHeader>,
}

impl From<ResponseHead> for WasmResponseHead {
    fn from(value: ResponseHead) -> Self {
        WasmResponseHead {
            status_code: value.status_code,
            headers: value
                .headers
                .into_iter()
                .map(|Header { key, value }| WasmHeader {
                    key: key.into(),
                    value: value.into(),
                })
                .collect(),
        }
    }
}

type WasmAsyncResultHandle = u32;

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmFailure {
    pub code: u16,
    pub message: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmExponentialRetryConfig {
    pub initial_interval: Option<u64>,
    pub factor: f32,
    pub max_interval: Option<u64>,
    pub max_attempts: Option<u32>,
    pub max_duration: Option<u64>,
}

impl From<WasmExponentialRetryConfig> for RetryPolicy {
    fn from(value: WasmExponentialRetryConfig) -> Self {
        RetryPolicy::Exponential {
            initial_interval: Duration::from_millis(value.initial_interval.unwrap_or(10)),
            max_attempts: value.max_attempts,
            max_duration: value.max_duration.map(Duration::from_millis),
            factor: value.factor,
            max_interval: value.max_interval.map(Duration::from_millis),
        }
    }
}

impl From<TerminalFailure> for WasmFailure {
    fn from(value: TerminalFailure) -> Self {
        WasmFailure {
            code: value.code,
            message: value.message,
        }
    }
}

impl From<WasmFailure> for TerminalFailure {
    fn from(value: WasmFailure) -> Self {
        TerminalFailure {
            code: value.code,
            message: value.message,
        }
    }
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmAwakeable {
    pub id: String,
    // Due to a bug in tsify, this doesn't correctly resolve the type alias WasmAsyncResultHandle, thus we use the u32 type directly.
    pub handle: u32,
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmInput {
    #[wasm_bindgen(readonly)]
    pub invocation_id: String,
    #[wasm_bindgen(readonly)]
    pub key: String,
    #[wasm_bindgen(readonly)]
    pub headers: Vec<WasmHeader>,
    #[wasm_bindgen(readonly)]
    pub input: Uint8Array,
}

impl From<Input> for WasmInput {
    fn from(value: Input) -> Self {
        WasmInput {
            invocation_id: value.invocation_id,
            key: value.key,
            headers: value.headers.into_iter().map(Into::into).collect(),
            input: (&*value.input).into(),
        }
    }
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WasmAsyncResultValue {
    NotReady,
    Empty,
    Success(
        // See https://github.com/madonoharu/tsify/pull/29
        #[tsify(type = "Uint8Array")] serde_bytes::ByteBuf,
    ),
    Failure(WasmFailure),
    StateKeys(Vec<String>),
    CombinatorResult(Vec<WasmAsyncResultHandle>),
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WasmRunEnterResult {
    ExecutedWithSuccess(
        // See https://github.com/madonoharu/tsify/pull/29
        #[tsify(type = "Uint8Array")] serde_bytes::ByteBuf,
    ),
    ExecutedWithFailure(WasmFailure),
    NotExecuted,
}

// VM implementation

#[wasm_bindgen]
pub struct WasmVM {
    vm: CoreVM,
}

#[wasm_bindgen]
impl WasmVM {
    #[wasm_bindgen(constructor)]
    pub fn new(headers: Vec<WasmHeader>) -> Result<WasmVM, JsError> {
        Ok(Self {
            vm: CoreVM::new(
                WasmHeaderList::from(headers),
                VMOptions {
                    fail_on_wait_concurrent_async_result: false,
                },
            )?,
        })
    }

    pub fn get_response_head(&self) -> WasmResponseHead {
        self.vm.get_response_head().into()
    }

    pub fn notify_input(&mut self, buffer: Vec<u8>) {
        let buf = buffer.into();
        self.vm.notify_input(buf);
    }

    pub fn notify_input_closed(&mut self) {
        self.vm.notify_input_closed();
    }

    pub fn notify_error(&mut self, error_message: String, error_description: Option<String>) {
        let mut e = Error::internal(error_message);
        if let Some(description) = error_description {
            e = e.with_description(description);
        }

        CoreVM::notify_error(&mut self.vm, e, None);
    }

    pub fn take_output(&mut self) -> JsValue {
        match self.vm.take_output() {
            TakeOutputResult::Buffer(v) => Uint8Array::from(&*v).into(),
            TakeOutputResult::EOF => JsValue::null(),
        }
    }

    pub fn is_ready_to_execute(&self) -> Result<bool, JsError> {
        self.vm.is_ready_to_execute().map_err(Into::into)
    }

    pub fn notify_await_point(&mut self, handle: WasmAsyncResultHandle) {
        self.vm.notify_await_point(handle.into())
    }

    pub fn take_async_result(
        &mut self,
        handle: WasmAsyncResultHandle,
    ) -> Result<WasmAsyncResultValue, JsError> {
        Ok(
            match self.vm.take_async_result(AsyncResultHandle::from(handle))? {
                None => WasmAsyncResultValue::NotReady,
                Some(Value::Void) => WasmAsyncResultValue::Empty,
                Some(Value::Success(b)) => WasmAsyncResultValue::Success(b.to_vec().into()),
                Some(Value::Failure(f)) => WasmAsyncResultValue::Failure(f.into()),
                Some(Value::StateKeys(keys)) => WasmAsyncResultValue::StateKeys(keys),
                Some(Value::CombinatorResult(handles)) => WasmAsyncResultValue::CombinatorResult(
                    handles.into_iter().map(Into::into).collect(),
                ),
            },
        )
    }

    // Syscall(s)

    pub fn sys_input(&mut self) -> Result<WasmInput, JsError> {
        self.vm.sys_input().map(Into::into).map_err(Into::into)
    }

    pub fn sys_get_state(&mut self, key: String) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_state_get(key)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_get_state_keys(&mut self) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_state_get_keys()
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_set_state(
        &mut self,
        key: String,
        buffer: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        self.vm
            .sys_state_set(key, buffer.to_vec().into())
            .map_err(Into::into)
    }

    pub fn sys_clear_state(&mut self, key: String) -> Result<(), JsError> {
        self.vm.sys_state_clear(key).map_err(Into::into)
    }

    pub fn sys_clear_all_state(&mut self) -> Result<(), JsError> {
        self.vm.sys_state_clear_all().map_err(Into::into)
    }

    pub fn sys_sleep(&mut self, millis: u64) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_sleep(duration_since_unix_epoch() + Duration::from_millis(millis))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_call(
        &mut self,
        service: String,
        handler: String,
        buffer: js_sys::Uint8Array,
        key: Option<String>,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_call(
                Target {
                    service,
                    handler,
                    key,
                },
                buffer.to_vec().into(),
            )
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_send(
        &mut self,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        delay: Option<u64>,
    ) -> Result<(), JsError> {
        self.vm
            .sys_send(
                Target {
                    service,
                    handler,
                    key,
                },
                buffer.to_vec().into(),
                delay.map(|delay| duration_since_unix_epoch() + Duration::from_millis(delay)),
            )
            .map_err(Into::into)
    }

    pub fn sys_awakeable(&mut self) -> Result<WasmAwakeable, JsError> {
        self.vm
            .sys_awakeable()
            .map(|(id, handle)| WasmAwakeable {
                id,
                handle: handle.into(),
            })
            .map_err(Into::into)
    }

    pub fn sys_complete_awakeable_success(
        &mut self,
        id: String,
        buffer: Uint8Array,
    ) -> Result<(), JsError> {
        self.vm
            .sys_complete_awakeable(id, NonEmptyValue::Success(buffer.to_vec().into()))
            .map_err(Into::into)
    }

    pub fn sys_complete_awakeable_failure(
        &mut self,
        id: String,
        value: WasmFailure,
    ) -> Result<(), JsError> {
        self.vm
            .sys_complete_awakeable(id, NonEmptyValue::Failure(value.into()))
            .map_err(Into::into)
    }

    pub fn sys_get_promise(&mut self, key: String) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_get_promise(key)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_peek_promise(&mut self, key: String) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_peek_promise(key)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_complete_promise_success(
        &mut self,
        key: String,
        buffer: Uint8Array,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_complete_promise(key, NonEmptyValue::Success(buffer.to_vec().into()))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_complete_promise_failure(
        &mut self,
        key: String,
        value: WasmFailure,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_complete_promise(key, NonEmptyValue::Failure(value.into()))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_run_enter(&mut self, name: String) -> Result<WasmRunEnterResult, JsError> {
        Ok(match self.vm.sys_run_enter(name)? {
            RunEnterResult::Executed(NonEmptyValue::Success(b)) => {
                WasmRunEnterResult::ExecutedWithSuccess(b.to_vec().into())
            }
            RunEnterResult::Executed(NonEmptyValue::Failure(f)) => {
                WasmRunEnterResult::ExecutedWithFailure(f.into())
            }
            RunEnterResult::NotExecuted(_) => WasmRunEnterResult::NotExecuted,
        })
    }

    pub fn sys_run_exit_success(
        &mut self,
        buffer: Uint8Array,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        CoreVM::sys_run_exit(
            &mut self.vm,
            RunExitResult::Success(buffer.to_vec().into()),
            RetryPolicy::None,
        )
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_run_exit_failure(
        &mut self,
        value: WasmFailure,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_run_exit(
                RunExitResult::TerminalFailure(value.into()),
                RetryPolicy::None,
            )
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_run_exit_failure_transient(
        &mut self,
        error_message: String,
        error_description: Option<String>,
        attempt_duration: u64,
        config: WasmExponentialRetryConfig,
    ) -> Result<WasmAsyncResultHandle, JsError> {
        self.vm
            .sys_run_exit(
                RunExitResult::RetryableFailure {
                    attempt_duration: Duration::from_millis(attempt_duration),
                    error: Error::internal(error_message)
                        .with_description(error_description.unwrap_or_default()),
                },
                config.into(),
            )
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_write_output_success(&mut self, buffer: js_sys::Uint8Array) -> Result<(), JsError> {
        self.vm
            .sys_write_output(NonEmptyValue::Success(buffer.to_vec().into()))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_write_output_failure(&mut self, value: WasmFailure) -> Result<(), JsError> {
        self.vm
            .sys_write_output(NonEmptyValue::Failure(value.into()))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_end(&mut self) -> Result<(), JsError> {
        self.vm.sys_end().map(Into::into).map_err(Into::into)
    }

    pub fn is_processing(&self) -> bool {
        self.vm.is_processing()
    }

    pub fn is_inside_run(&self) -> bool {
        self.vm.is_inside_run()
    }

    pub fn sys_try_complete_all_combinator(
        &mut self,
        handles: Vec<WasmAsyncResultHandle>,
    ) -> Result<Option<WasmAsyncResultHandle>, JsError> {
        self.vm
            .sys_try_complete_combinator(AllAsyncResultCombinator(
                handles.into_iter().map(Into::into).collect(),
            ))
            .map(|opt| opt.map(Into::into))
            .map_err(Into::into)
    }

    pub fn sys_try_complete_any_combinator(
        &mut self,
        handles: Vec<WasmAsyncResultHandle>,
    ) -> Result<Option<WasmAsyncResultHandle>, JsError> {
        self.vm
            .sys_try_complete_combinator(AnyAsyncResultCombinator(
                handles.into_iter().map(Into::into).collect(),
            ))
            .map(|opt| opt.map(Into::into))
            .map_err(Into::into)
    }

    pub fn sys_try_complete_all_settled_combinator(
        &mut self,
        handles: Vec<WasmAsyncResultHandle>,
    ) -> Result<Option<WasmAsyncResultHandle>, JsError> {
        self.vm
            .sys_try_complete_combinator(AllSettledAsyncResultCombinator(
                handles.into_iter().map(Into::into).collect(),
            ))
            .map(|opt| opt.map(Into::into))
            .map_err(Into::into)
    }

    pub fn sys_try_complete_race_combinator(
        &mut self,
        handles: Vec<WasmAsyncResultHandle>,
    ) -> Result<Option<WasmAsyncResultHandle>, JsError> {
        self.vm
            .sys_try_complete_combinator(RaceAsyncResultCombinator(
                handles.into_iter().map(Into::into).collect(),
            ))
            .map(|opt| opt.map(Into::into))
            .map_err(Into::into)
    }
}

/// Same semantics as [`Promise.any`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/any).
#[derive(Debug)]
struct AnyAsyncResultCombinator(Vec<AsyncResultHandle>);

impl AsyncResultCombinator for AnyAsyncResultCombinator {
    fn try_complete(
        &self,
        tracker: &mut AsyncResultAccessTracker,
    ) -> Option<Vec<AsyncResultHandle>> {
        let mut failed_count = 0;
        for handle in &self.0 {
            match tracker.get_state(*handle) {
                AsyncResultState::Success => return Some(vec![*handle]),
                AsyncResultState::Failure => {
                    failed_count += 1;
                }
                AsyncResultState::NotReady => {}
            };
        }

        if failed_count == self.0.len() {
            // All failed!
            Some(self.0.clone())
        } else {
            // Not ready yet
            None
        }
    }
}

/// Same semantics as [`Promise.race`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race).
#[derive(Debug)]
struct RaceAsyncResultCombinator(Vec<AsyncResultHandle>);

impl AsyncResultCombinator for RaceAsyncResultCombinator {
    fn try_complete(
        &self,
        tracker: &mut AsyncResultAccessTracker,
    ) -> Option<Vec<AsyncResultHandle>> {
        for handle in &self.0 {
            match tracker.get_state(*handle) {
                AsyncResultState::Success => return Some(vec![*handle]),
                AsyncResultState::Failure => return Some(vec![*handle]),
                AsyncResultState::NotReady => {}
            };
        }

        // None is ready yet
        None
    }
}

/// Same semantics as [`Promise.all`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all).
#[derive(Debug)]
struct AllAsyncResultCombinator(Vec<AsyncResultHandle>);

impl AsyncResultCombinator for AllAsyncResultCombinator {
    fn try_complete(
        &self,
        tracker: &mut AsyncResultAccessTracker,
    ) -> Option<Vec<AsyncResultHandle>> {
        let mut succeeded_count = 0;
        for handle in &self.0 {
            match tracker.get_state(*handle) {
                AsyncResultState::Success => {
                    succeeded_count += 1;
                }
                AsyncResultState::Failure => return Some(vec![*handle]),
                AsyncResultState::NotReady => {}
            };
        }

        if succeeded_count == self.0.len() {
            // All succeeded!
            Some(self.0.clone())
        } else {
            // Not ready yet
            None
        }
    }
}

/// Same semantics as [`Promise.allSettled`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race).
#[derive(Debug)]
struct AllSettledAsyncResultCombinator(Vec<AsyncResultHandle>);

impl AsyncResultCombinator for AllSettledAsyncResultCombinator {
    fn try_complete(
        &self,
        tracker: &mut AsyncResultAccessTracker,
    ) -> Option<Vec<AsyncResultHandle>> {
        for handle in &self.0 {
            match tracker.get_state(*handle) {
                AsyncResultState::Success | AsyncResultState::Failure => {}
                AsyncResultState::NotReady => return None,
            };
        }

        Some(self.0.clone())
    }
}

fn duration_since_unix_epoch() -> Duration {
    Duration::from_millis(js_sys::Date::now() as u64)
}

// We need this wrapper for the shared core
struct WasmHeaderList(Vec<WasmHeader>);

impl From<Vec<WasmHeader>> for WasmHeaderList {
    fn from(value: Vec<WasmHeader>) -> Self {
        Self(value)
    }
}

impl HeaderMap for WasmHeaderList {
    type Error = Infallible;

    fn extract(&self, name: &str) -> Result<Option<&str>, Self::Error> {
        for WasmHeader { key, value } in &self.0 {
            if key.eq_ignore_ascii_case(name) {
                return Ok(Some(value));
            }
        }
        Ok(None)
    }
}
