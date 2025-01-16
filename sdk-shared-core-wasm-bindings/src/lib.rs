use js_sys::Uint8Array;
use restate_sdk_shared_core::{
    CallHandle, CoreVM, DoProgressResponse, Error, Header, HeaderMap, IdentityVerifier, Input,
    NonEmptyValue, ResponseHead, RetryPolicy, RunExitResult, SendHandle, SuspendedOrVMError,
    TakeOutputResult, Target, TerminalFailure, VMOptions, Value, CANCEL_NOTIFICATION_HANDLE, VM,
};
use serde::{Deserialize, Serialize};
use std::cmp;
use std::convert::{Infallible, Into};
use std::io::Write;
use std::time::Duration;
use tracing::metadata::LevelFilter;
use tracing::{Dispatch, Level, Subscriber};
use tracing_subscriber::fmt::format::FmtSpan;
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
    fn vm_log(level: LogLevel, s: &[u8], logger_id: Option<u32>);
}

pub struct MakeWebConsoleWriter {
    logger_id: Option<u32>,
}

impl<'a> MakeWriter<'a> for MakeWebConsoleWriter {
    type Writer = ConsoleWriter;

    fn make_writer(&'a self) -> Self::Writer {
        ConsoleWriter {
            buffer: vec![],
            level: Level::TRACE, // if no level is known, assume the most detailed
            logger_id: self.logger_id,
        }
    }

    fn make_writer_for(&'a self, meta: &tracing::Metadata<'_>) -> Self::Writer {
        let level = *meta.level();
        ConsoleWriter {
            buffer: vec![],
            level,
            logger_id: self.logger_id,
        }
    }
}

pub struct ConsoleWriter {
    buffer: Vec<u8>,

    level: Level,
    logger_id: Option<u32>,
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
        vm_log(
            match self.level {
                Level::TRACE => LogLevel::TRACE,
                Level::DEBUG => LogLevel::DEBUG,
                Level::INFO => LogLevel::INFO,
                Level::WARN => LogLevel::WARN,
                Level::ERROR => LogLevel::ERROR,
            },
            // Remove last character, which is always a new line
            &self.buffer[..cmp::max(0, self.buffer.len() - 1)],
            self.logger_id,
        )
    }
}

/// This will set the log level of the overall log subscriber.
#[wasm_bindgen]
pub fn set_log_level(level: LogLevel) {
    let _ = tracing::subscriber::set_global_default(log_subscriber(level, None));
}

fn log_subscriber(
    level: LogLevel,
    logger_id: Option<u32>,
) -> impl Subscriber + Send + Sync + 'static {
    let level = match level {
        LogLevel::TRACE => Level::TRACE,
        LogLevel::DEBUG => Level::DEBUG,
        LogLevel::INFO => Level::INFO,
        LogLevel::WARN => Level::WARN,
        LogLevel::ERROR => Level::ERROR,
    };

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .without_time()
        .with_thread_names(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .with_target(level == Level::TRACE)
        .with_level(false)
        .with_span_events(if level == Level::TRACE {
            FmtSpan::ENTER
        } else {
            FmtSpan::NONE
        })
        .with_writer(MakeWebConsoleWriter { logger_id })
        // We do filtering here too,
        // as it might get expensive to pass logs through
        // the various layers even though we don't need them
        .with_filter(LevelFilter::from_level(level));
    Registry::default().with(fmt_layer)
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

impl From<WasmHeader> for Header {
    fn from(h: WasmHeader) -> Self {
        Header {
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

type WasmNotificationHandle = u32;

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmFailure {
    pub code: u16,
    pub message: String,
}

impl From<Error> for WasmFailure {
    fn from(value: Error) -> Self {
        WasmFailure {
            code: value.code(),
            message: value.to_string(),
        }
    }
}

impl From<WasmFailure> for JsValue {
    fn from(value: WasmFailure) -> Self {
        serde_wasm_bindgen::to_value(&value).unwrap_or_else(|e| e.into())
    }
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
    InvocationId(String),
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WasmDoProgressResult {
    /// Any of the given AsyncResultHandle completed
    AnyCompleted,
    /// The SDK should read from input at this point
    ReadFromInput,
    /// Any of the run given before with ExecuteRun is waiting for completion
    WaitingPendingRun,
    /// The SDK should execute a pending run
    ExecuteRun(#[tsify(type = "number")] WasmNotificationHandle),
}

impl From<DoProgressResponse> for WasmDoProgressResult {
    fn from(value: DoProgressResponse) -> Self {
        match value {
            DoProgressResponse::AnyCompleted => WasmDoProgressResult::AnyCompleted,
            DoProgressResponse::ReadFromInput => WasmDoProgressResult::ReadFromInput,
            DoProgressResponse::WaitingPendingRun => WasmDoProgressResult::WaitingPendingRun,
            DoProgressResponse::ExecuteRun(n) => WasmDoProgressResult::ExecuteRun(n.into()),
        }
    }
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmCallHandle {
    #[tsify(type = "number")]
    invocation_id_completion_id: WasmNotificationHandle,
    #[tsify(type = "number")]
    call_completion_id: WasmNotificationHandle,
}

impl From<CallHandle> for WasmCallHandle {
    fn from(value: CallHandle) -> Self {
        Self {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
            call_completion_id: value.call_notification_handle.into(),
        }
    }
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmSendHandle {
    #[tsify(type = "number")]
    invocation_id_completion_id: WasmNotificationHandle,
}

impl From<SendHandle> for WasmSendHandle {
    fn from(value: SendHandle) -> Self {
        Self {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
        }
    }
}

// VM implementation

#[wasm_bindgen]
pub struct WasmVM {
    vm: CoreVM,
    log_dispatcher: Dispatch,
}

macro_rules! use_log_dispatcher {
    ($vm:expr, $f:expr) => {{
        let WasmVM { vm, log_dispatcher } = $vm;
        tracing::dispatcher::with_default(&log_dispatcher, || $f(vm))
    }};
}

#[wasm_bindgen]
impl WasmVM {
    #[wasm_bindgen(constructor)]
    pub fn new(
        headers: Vec<WasmHeader>,
        log_level: LogLevel,
        logger_id: u32,
    ) -> Result<WasmVM, WasmFailure> {
        let log_dispatcher = Dispatch::new(log_subscriber(log_level, Some(logger_id)));

        let vm = tracing::dispatcher::with_default(&log_dispatcher, || {
            CoreVM::new(WasmHeaderList::from(headers), VMOptions {})
        })?;

        Ok(Self { vm, log_dispatcher })
    }

    pub fn get_response_head(&self) -> WasmResponseHead {
        use_log_dispatcher!(self, |vm| CoreVM::get_response_head(vm).into())
    }

    pub fn notify_input(&mut self, buffer: Vec<u8>) {
        let buf = buffer.into();
        use_log_dispatcher!(self, |vm| CoreVM::notify_input(vm, buf))
    }

    pub fn notify_input_closed(&mut self) {
        self.vm.notify_input_closed();
    }

    pub fn notify_error(&mut self, error_message: String, error_description: Option<String>) {
        let mut e = Error::internal(error_message);
        if let Some(description) = error_description {
            e = e.with_description(description);
        }

        use_log_dispatcher!(self, |vm| CoreVM::notify_error(vm, e, None))
    }

    pub fn take_output(&mut self) -> JsValue {
        match use_log_dispatcher!(self, CoreVM::take_output) {
            TakeOutputResult::Buffer(v) => Uint8Array::from(&*v).into(),
            TakeOutputResult::EOF => JsValue::null(),
        }
    }

    pub fn is_ready_to_execute(&self) -> Result<bool, WasmFailure> {
        use_log_dispatcher!(self, CoreVM::is_ready_to_execute).map_err(Into::into)
    }

    pub fn is_completed(&self, handle: WasmNotificationHandle) -> bool {
        use_log_dispatcher!(self, |vm| CoreVM::is_completed(vm, handle.into()))
    }

    pub fn do_progress(
        &mut self,
        handles: Vec<WasmNotificationHandle>,
    ) -> Result<WasmDoProgressResult, WasmFailure> {
        Ok(use_log_dispatcher!(self, |vm| CoreVM::do_progress(
            vm,
            handles.into_iter().map(Into::into).collect()
        ))
        .map_err(|e| match e {
            SuspendedOrVMError::Suspended(_) => WasmFailure {
                code: 599,
                message: "suspended".to_string(),
            },
            SuspendedOrVMError::VM(e) => WasmFailure::from(e),
        })?
        .into())
    }

    pub fn take_notification(
        &mut self,
        handle: WasmNotificationHandle,
    ) -> Result<WasmAsyncResultValue, WasmFailure> {
        Ok(
            match use_log_dispatcher!(self, |vm| CoreVM::take_notification(vm, handle.into()))
                .map_err(|e| match e {
                    SuspendedOrVMError::Suspended(_) => WasmFailure {
                        code: 599,
                        message: "suspended".to_string(),
                    },
                    SuspendedOrVMError::VM(e) => WasmFailure::from(e),
                })? {
                None => WasmAsyncResultValue::NotReady,
                Some(Value::Void) => WasmAsyncResultValue::Empty,
                Some(Value::Success(b)) => WasmAsyncResultValue::Success(b.to_vec().into()),
                Some(Value::Failure(f)) => WasmAsyncResultValue::Failure(f.into()),
                Some(Value::StateKeys(keys)) => WasmAsyncResultValue::StateKeys(keys),
                Some(Value::InvocationId(invocation_id)) => {
                    WasmAsyncResultValue::InvocationId(invocation_id)
                }
            },
        )
    }

    // Syscall(s)

    pub fn sys_input(&mut self) -> Result<WasmInput, WasmFailure> {
        use_log_dispatcher!(self, CoreVM::sys_input)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_get_state(&mut self, key: String) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_state_get(vm, key))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_get_state_keys(&mut self) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, CoreVM::sys_state_get_keys)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_set_state(
        &mut self,
        key: String,
        buffer: js_sys::Uint8Array,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_state_set(
            vm,
            key,
            buffer.to_vec().into()
        ))
        .map_err(Into::into)
    }

    pub fn sys_clear_state(&mut self, key: String) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_state_clear(vm, key)).map_err(Into::into)
    }

    pub fn sys_clear_all_state(&mut self) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, CoreVM::sys_state_clear_all).map_err(Into::into)
    }

    pub fn sys_sleep(&mut self, millis: u64) -> Result<WasmNotificationHandle, WasmFailure> {
        let now = now_since_unix_epoch();
        use_log_dispatcher!(self, |vm| CoreVM::sys_sleep(
            vm,
            now + Duration::from_millis(millis),
            Some(now)
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_call(
        &mut self,
        service: String,
        handler: String,
        buffer: js_sys::Uint8Array,
        key: Option<String>,
        headers: Vec<WasmHeader>,
    ) -> Result<WasmCallHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_call(
            vm,
            Target {
                service,
                handler,
                key,
                idempotency_key: None,
                headers: headers.into_iter().map(Header::from).collect(),
            },
            buffer.to_vec().into()
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn sys_send(
        &mut self,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        headers: Vec<WasmHeader>,
        delay: Option<u64>,
    ) -> Result<WasmSendHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_send(
            vm,
            Target {
                service,
                handler,
                key,
                idempotency_key: None,
                headers: headers.into_iter().map(Header::from).collect(),
            },
            buffer.to_vec().into(),
            delay.map(|delay| now_since_unix_epoch() + Duration::from_millis(delay)),
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_awakeable(&mut self) -> Result<WasmAwakeable, WasmFailure> {
        use_log_dispatcher!(self, CoreVM::sys_awakeable)
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
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_complete_awakeable(
            vm,
            id,
            NonEmptyValue::Success(buffer.to_vec().into())
        ))
        .map_err(Into::into)
    }

    pub fn sys_complete_awakeable_failure(
        &mut self,
        id: String,
        value: WasmFailure,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_complete_awakeable(
            vm,
            id,
            NonEmptyValue::Failure(value.into())
        ))
        .map_err(Into::into)
    }

    pub fn sys_get_promise(&mut self, key: String) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_get_promise(vm, key))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_peek_promise(&mut self, key: String) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_peek_promise(vm, key))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_complete_promise_success(
        &mut self,
        key: String,
        buffer: Uint8Array,
    ) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_complete_promise(
            vm,
            key,
            NonEmptyValue::Success(buffer.to_vec().into())
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_complete_promise_failure(
        &mut self,
        key: String,
        value: WasmFailure,
    ) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_complete_promise(
            vm,
            key,
            NonEmptyValue::Failure(value.into())
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_run(&mut self, name: String) -> Result<WasmNotificationHandle, WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_run(vm, name))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn propose_run_completion_success(
        &mut self,
        handle: WasmNotificationHandle,
        buffer: Uint8Array,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            RunExitResult::Success(buffer.to_vec().into()),
            RetryPolicy::None,
        ))
        .map_err(Into::into)
    }

    pub fn propose_run_completion_failure(
        &mut self,
        handle: WasmNotificationHandle,
        value: WasmFailure,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            RunExitResult::TerminalFailure(value.into()),
            RetryPolicy::None
        ))
        .map_err(Into::into)
    }

    pub fn propose_run_completion_failure_transient(
        &mut self,
        handle: WasmNotificationHandle,
        error_message: String,
        error_description: Option<String>,
        attempt_duration: u64,
        config: WasmExponentialRetryConfig,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            RunExitResult::RetryableFailure {
                attempt_duration: Duration::from_millis(attempt_duration),
                error: Error::internal(error_message)
                    .with_description(error_description.unwrap_or_default()),
            },
            config.into()
        ))
        .map_err(Into::into)
    }

    pub fn sys_cancel_invocation(
        &mut self,
        target_invocation_id: String,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_cancel_invocation(
            vm,
            target_invocation_id
        ))
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn sys_write_output_success(
        &mut self,
        buffer: js_sys::Uint8Array,
    ) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_write_output(
            vm,
            NonEmptyValue::Success(buffer.to_vec().into())
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_write_output_failure(&mut self, value: WasmFailure) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, |vm| CoreVM::sys_write_output(
            vm,
            NonEmptyValue::Failure(value.into())
        ))
        .map(Into::into)
        .map_err(Into::into)
    }

    pub fn sys_end(&mut self) -> Result<(), WasmFailure> {
        use_log_dispatcher!(self, CoreVM::sys_end)
            .map(Into::into)
            .map_err(Into::into)
    }

    pub fn is_processing(&self) -> bool {
        use_log_dispatcher!(self, CoreVM::is_processing)
    }
}

fn now_since_unix_epoch() -> Duration {
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

#[wasm_bindgen]
pub struct WasmIdentityVerifier {
    identity_verifier: IdentityVerifier,
}

#[wasm_bindgen]
impl WasmIdentityVerifier {
    #[wasm_bindgen(constructor)]
    pub fn new(keys: Vec<String>) -> Result<WasmIdentityVerifier, JsError> {
        let k: Vec<_> = keys.iter().map(|s| s.as_str()).collect();
        Ok(WasmIdentityVerifier {
            identity_verifier: IdentityVerifier::new(&k)?,
        })
    }

    pub fn verify_identity(&self, path: &str, headers: Vec<WasmHeader>) -> Result<(), JsError> {
        self.identity_verifier
            .verify_identity(&WasmHeaderList(headers), path)?;
        Ok(())
    }
}

#[wasm_bindgen]
pub fn cancel_handle() -> WasmNotificationHandle {
    CANCEL_NOTIFICATION_HANDLE.into()
}
