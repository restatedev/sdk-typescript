// napi-rs build of the Restate SDK shared core.
//
// One crate, two artifacts: a native `.node` addon (Node/Deno/Bun) and a threadless
// `wasm32-wasip1` wasm (Cloudflare Workers / edge). It exposes the `VM` state machine plus its
// value types (`Header`, `Input`, `Failure`, ...). The JS-facing classes are named without a
// prefix; internally the shared-core's own `Header`/`Failure`/... types are imported under `Core*`
// aliases to avoid the name clash. napi camelCases method / function / object-field names by
// default, so every snake_case name is pinned with `#[napi(js_name = "...")]`.

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::convert::Infallible;
use std::io::Write;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use restate_sdk_shared_core::tracing_pretty::{Pretty, PrettyFields};
use restate_sdk_shared_core::{
    AttachInvocationTarget, AwaitResponse, AwakeableHandle, CallHandle as CoreCallHandle,
    CommandRelationship, CommandType as CoreCommandType, CoreVM, Error as CoreError,
    Header as CoreHeader, HeaderMap, IdentityVerifier as CoreIdentityVerifier,
    ImplicitCancellationOption, Input as CoreInput, JournalMismatchRetryBehavior,
    NonDeterministicChecksOption, NonEmptyValue, OnMaxAttempts, ResponseHead as CoreResponseHead,
    RetryPolicy, RunExitResult, RunHandle, SendHandle as CoreSendHandle, Target, TerminalFailure,
    UnresolvedFuture as CoreUnresolvedFuture, VMOptions, Value, CANCEL_NOTIFICATION_HANDLE,
    VM as CoreVmTrait,
};
use tracing::metadata::LevelFilter;
use tracing::{Dispatch, Level, Subscriber};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};

// ---------------------------------------------------------------------------
// Small napi helpers
// ---------------------------------------------------------------------------

/// Convert any `ToNapiValue` into an `Unknown` bound to `env`.
fn to_unknown<'e, T: ToNapiValue>(env: &'e Env, v: T) -> Result<Unknown<'e>> {
    let raw = unsafe { ToNapiValue::to_napi_value(env.raw(), v)? };
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw) })
}

/// Build a single-key JS object `{ key: val }` (externally-tagged enum shape).
fn single_key_obj<'e, T: ToNapiValue>(env: &'e Env, key: &str, val: T) -> Result<Unknown<'e>> {
    let mut obj = Object::new(env)?;
    obj.set(key, val)?;
    Ok(obj.to_unknown())
}

/// Throw a `Failure` as a **plain JS object** (not an `Error`), matching the wasm build so
/// the SDK's `errors.ts:ensureError` extracts `{code,message,metadata}`.
fn throw_failure(env: &Env, failure: Failure) -> Error {
    match to_unknown(env, failure) {
        Ok(value) => {
            let _ = env.throw(value);
            Error::from_status(Status::PendingException)
        }
        Err(e) => e,
    }
}

fn now_since_unix_epoch() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Logging bridge
//
// The wasm build imports `vm_log`/`fatal` from `../core_logging.js`. napi has no static import,
// so the SDK hands us the two JS functions via `registerLogCallbacks`. Everything runs on the JS
// thread, so we buffer log records emitted by the tracing subscriber during a VM call and flush
// them synchronously (via a stored `FunctionRef`) at the end of that call.
// ---------------------------------------------------------------------------

type VmLogRef = FunctionRef<FnArgs<(u32, Uint8Array, Option<u32>)>, ()>;
type FatalRef = FunctionRef<String, ()>;

thread_local! {
    static LOG_BUF: RefCell<Vec<(u8, Vec<u8>, Option<u32>)>> = const { RefCell::new(Vec::new()) };
    static VM_LOG: RefCell<Option<VmLogRef>> = const { RefCell::new(None) };
    static FATAL: RefCell<Option<FatalRef>> = const { RefCell::new(None) };
}

static PANIC_HOOK_SET: OnceLock<()> = OnceLock::new();

fn ensure_panic_hook() {
    PANIC_HOOK_SET.get_or_init(|| {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // We cannot call back into JS here without an Env; log to stderr and let napi-rs
            // convert the panic into a JS exception at the FFI boundary.
            eprintln!("FATAL: the Restate SDK shared-core panicked: {info}");
            prev(info);
        }));
    });
}

#[napi(js_name = "registerLogCallbacks")]
pub fn register_log_callbacks(
    vm_log: Function<FnArgs<(u32, Uint8Array, Option<u32>)>, ()>,
    fatal: Function<String, ()>,
) -> Result<()> {
    let vm_log_ref = vm_log.create_ref()?;
    let fatal_ref = fatal.create_ref()?;
    VM_LOG.with(|c| *c.borrow_mut() = Some(vm_log_ref));
    FATAL.with(|c| *c.borrow_mut() = Some(fatal_ref));
    ensure_panic_hook();
    Ok(())
}

/// Drain buffered log records and forward them to the registered JS `vm_log`, synchronously.
fn flush_logs(env: &Env) {
    let drained: Vec<(u8, Vec<u8>, Option<u32>)> =
        LOG_BUF.with(|b| std::mem::take(&mut *b.borrow_mut()));
    if drained.is_empty() {
        return;
    }
    VM_LOG.with(|c| {
        if let Some(r) = c.borrow().as_ref() {
            if let Ok(f) = r.borrow_back(env) {
                for (level, bytes, logger_id) in drained {
                    let _ = f.call(FnArgs::from((
                        level as u32,
                        Uint8Array::new(bytes),
                        logger_id,
                    )));
                }
            }
        }
    });
}

fn level_to_u8(level: &Level) -> u8 {
    match *level {
        Level::TRACE => 0,
        Level::DEBUG => 1,
        Level::INFO => 2,
        Level::WARN => 3,
        Level::ERROR => 4,
    }
}

struct MakeBufWriter {
    logger_id: Option<u32>,
}

impl<'a> MakeWriter<'a> for MakeBufWriter {
    type Writer = BufWriter;

    fn make_writer(&'a self) -> Self::Writer {
        BufWriter {
            buffer: vec![],
            level: Level::TRACE,
            logger_id: self.logger_id,
        }
    }

    fn make_writer_for(&'a self, meta: &tracing::Metadata<'_>) -> Self::Writer {
        BufWriter {
            buffer: vec![],
            level: *meta.level(),
            logger_id: self.logger_id,
        }
    }
}

struct BufWriter {
    buffer: Vec<u8>,
    level: Level,
    logger_id: Option<u32>,
}

impl Write for BufWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for BufWriter {
    fn drop(&mut self) {
        // Remove the trailing newline, matching the wasm ConsoleWriter.
        let end = self.buffer.len().saturating_sub(1);
        let bytes = self.buffer[..end].to_vec();
        match self.logger_id {
            // Per-invocation logs are routed to the SDK logger via vm_log.
            Some(_) => LOG_BUF.with(|b| {
                b.borrow_mut().push((level_to_u8(&self.level), bytes, self.logger_id))
            }),
            // The global subscriber (no logger id) writes straight to stderr to avoid buffering
            // records with no VM call to flush them.
            None => {
                let mut stderr = std::io::stderr();
                let _ = stderr.write_all(&bytes);
                let _ = stderr.write_all(b"\n");
            }
        }
    }
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

    let fmt_layer = if level == Level::TRACE {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .without_time()
            .with_span_events(FmtSpan::ENTER)
            .with_writer(MakeBufWriter { logger_id })
            .event_format(
                Pretty::default()
                    .without_time()
                    .with_thread_names(false)
                    .with_thread_ids(false)
                    .with_target(true)
                    .with_level(true),
            )
            .fmt_fields(PrettyFields::default())
            .boxed()
    } else {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .without_time()
            .with_thread_names(false)
            .with_thread_ids(false)
            .with_file(false)
            .with_line_number(false)
            .with_target(false)
            .with_level(false)
            .with_span_events(FmtSpan::NONE)
            .with_writer(MakeBufWriter { logger_id })
            .boxed()
    };

    Registry::default().with(fmt_layer.with_filter(LevelFilter::from_level(level)))
}

/// Setups the module (parity with the wasm `start`).
#[napi]
pub fn start() {
    ensure_panic_hook();
}

/// This will set the log level of the overall log subscriber.
#[napi(js_name = "set_log_level")]
pub fn set_log_level(level: LogLevel) {
    let _ = tracing::subscriber::set_global_default(log_subscriber(level, None));
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[napi]
pub enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
}

/// How the state machine should behave when it hits a journal mismatch (non-determinism) error.
#[napi]
pub enum JournalMismatchBehavior {
    /// Follow the normal retry policy.
    Retry = 0,
    /// Pause the invocation instead of retrying.
    Pause = 1,
    /// Fail the invocation terminally instead of retrying.
    Fail = 2,
}

impl From<JournalMismatchBehavior> for JournalMismatchRetryBehavior {
    fn from(value: JournalMismatchBehavior) -> Self {
        match value {
            JournalMismatchBehavior::Retry => Self::FollowRetryPolicy,
            JournalMismatchBehavior::Pause => Self::Pause,
            JournalMismatchBehavior::Fail => Self::FailTerminally,
        }
    }
}

#[napi]
pub enum CommandType {
    Input = 0,
    Output = 1,
    GetState = 2,
    GetStateKeys = 3,
    SetState = 4,
    ClearState = 5,
    ClearAllState = 6,
    GetPromise = 7,
    PeekPromise = 8,
    CompletePromise = 9,
    Sleep = 10,
    Call = 11,
    OneWayCall = 12,
    SendSignal = 13,
    Run = 14,
    AttachInvocation = 15,
    GetInvocationOutput = 16,
    CompleteAwakeable = 17,
    CancelInvocation = 18,
}

impl From<CommandType> for CoreCommandType {
    fn from(value: CommandType) -> Self {
        match value {
            CommandType::Input => CoreCommandType::Input,
            CommandType::Output => CoreCommandType::Output,
            CommandType::GetState => CoreCommandType::GetState,
            CommandType::GetStateKeys => CoreCommandType::GetStateKeys,
            CommandType::SetState => CoreCommandType::SetState,
            CommandType::ClearState => CoreCommandType::ClearState,
            CommandType::ClearAllState => CoreCommandType::ClearAllState,
            CommandType::GetPromise => CoreCommandType::GetPromise,
            CommandType::PeekPromise => CoreCommandType::PeekPromise,
            CommandType::CompletePromise => CoreCommandType::CompletePromise,
            CommandType::Sleep => CoreCommandType::Sleep,
            CommandType::Call => CoreCommandType::Call,
            CommandType::OneWayCall => CoreCommandType::OneWayCall,
            CommandType::SendSignal => CoreCommandType::SendSignal,
            CommandType::Run => CoreCommandType::Run,
            CommandType::AttachInvocation => CoreCommandType::AttachInvocation,
            CommandType::GetInvocationOutput => CoreCommandType::GetInvocationOutput,
            CommandType::CompleteAwakeable => CoreCommandType::CompleteAwakeable,
            CommandType::CancelInvocation => CoreCommandType::CancelInvocation,
        }
    }
}

// ---------------------------------------------------------------------------
// Classes: Header / ResponseHead / Input
// ---------------------------------------------------------------------------

#[napi]
pub struct Header {
    key: String,
    value: String,
}

#[napi]
impl Header {
    #[napi(constructor)]
    pub fn new(key: String, value: String) -> Self {
        Header { key, value }
    }
    #[napi(getter)]
    pub fn key(&self) -> String {
        self.key.clone()
    }
    #[napi(getter)]
    pub fn value(&self) -> String {
        self.value.clone()
    }
}

fn to_core_header(h: &Header) -> CoreHeader {
    CoreHeader {
        key: h.key.clone().into(),
        value: h.value.clone().into(),
    }
}

fn header_pairs(headers: &[&Header]) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|h| (h.key.clone(), h.value.clone()))
        .collect()
}

fn pairs_to_wasm_headers(pairs: &[(String, String)]) -> Vec<Header> {
    pairs
        .iter()
        .map(|(k, v)| Header::new(k.clone(), v.clone()))
        .collect()
}

#[napi]
pub struct ResponseHead {
    status_code: u16,
    headers: Vec<(String, String)>,
}

#[napi]
impl ResponseHead {
    #[napi(getter, js_name = "status_code")]
    pub fn status_code(&self) -> u16 {
        self.status_code
    }
    #[napi(getter)]
    pub fn headers(&self) -> Vec<Header> {
        pairs_to_wasm_headers(&self.headers)
    }
}

impl From<CoreResponseHead> for ResponseHead {
    fn from(value: CoreResponseHead) -> Self {
        ResponseHead {
            status_code: value.status_code,
            headers: value
                .headers
                .into_iter()
                .map(|CoreHeader { key, value }| (key.into(), value.into()))
                .collect(),
        }
    }
}

#[napi]
pub struct Input {
    invocation_id: String,
    key: String,
    idempotency_key: Option<String>,
    scope: Option<String>,
    limit_key: Option<String>,
    headers: Vec<(String, String)>,
    input: Vec<u8>,
    random_seed: u64,
}

#[napi]
impl Input {
    #[napi(getter, js_name = "invocation_id")]
    pub fn invocation_id(&self) -> String {
        self.invocation_id.clone()
    }
    #[napi(getter)]
    pub fn key(&self) -> String {
        self.key.clone()
    }
    #[napi(getter, js_name = "idempotency_key")]
    pub fn idempotency_key(&self) -> Option<String> {
        self.idempotency_key.clone()
    }
    #[napi(getter)]
    pub fn scope(&self) -> Option<String> {
        self.scope.clone()
    }
    #[napi(getter, js_name = "limit_key")]
    pub fn limit_key(&self) -> Option<String> {
        self.limit_key.clone()
    }
    #[napi(getter)]
    pub fn headers(&self) -> Vec<Header> {
        pairs_to_wasm_headers(&self.headers)
    }
    #[napi(getter)]
    pub fn input(&self) -> Uint8Array {
        Uint8Array::new(self.input.clone())
    }
    #[napi(getter, js_name = "random_seed")]
    pub fn random_seed(&self) -> BigInt {
        BigInt::from(self.random_seed)
    }
}

impl From<CoreInput> for Input {
    fn from(value: CoreInput) -> Self {
        Input {
            invocation_id: value.invocation_id,
            key: value.key,
            idempotency_key: value.idempotency_key,
            scope: value.scope,
            limit_key: value.limit_key,
            headers: value
                .headers
                .into_iter()
                .map(|CoreHeader { key, value }| (key.into(), value.into()))
                .collect(),
            input: (*value.input).to_vec(),
            random_seed: value.random_seed,
        }
    }
}

// ---------------------------------------------------------------------------
// Plain objects
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct FailureMetadata {
    pub key: String,
    pub value: String,
}

#[napi(object)]
pub struct Failure {
    pub code: u16,
    pub message: String,
    pub metadata: Vec<FailureMetadata>,
}

impl From<CoreError> for Failure {
    fn from(value: CoreError) -> Self {
        Failure {
            code: value.code(),
            message: value.to_string(),
            metadata: vec![],
        }
    }
}

impl From<TerminalFailure> for Failure {
    fn from(value: TerminalFailure) -> Self {
        Failure {
            code: value.code,
            message: value.message,
            metadata: value
                .metadata
                .into_iter()
                .map(|(k, v)| FailureMetadata { key: k, value: v })
                .collect(),
        }
    }
}

impl From<Failure> for TerminalFailure {
    fn from(value: Failure) -> Self {
        TerminalFailure {
            code: value.code,
            message: value.message,
            metadata: value
                .metadata
                .into_iter()
                .map(|m| (m.key, m.value))
                .collect(),
        }
    }
}

#[napi(object)]
pub struct ExponentialRetryConfig {
    #[napi(js_name = "initial_interval")]
    pub initial_interval: Option<f64>,
    pub factor: f64,
    #[napi(js_name = "max_interval")]
    pub max_interval: Option<f64>,
    #[napi(js_name = "max_attempts")]
    pub max_attempts: Option<u32>,
    #[napi(js_name = "max_duration")]
    pub max_duration: Option<f64>,
}

impl From<ExponentialRetryConfig> for RetryPolicy {
    fn from(value: ExponentialRetryConfig) -> Self {
        RetryPolicy::Exponential {
            initial_interval: Duration::from_millis(
                value.initial_interval.map(|v| v as u64).unwrap_or(10),
            ),
            max_attempts: value.max_attempts,
            max_duration: value.max_duration.map(|v| Duration::from_millis(v as u64)),
            factor: value.factor as f32,
            max_interval: value.max_interval.map(|v| Duration::from_millis(v as u64)),
            on_max_attempts: OnMaxAttempts::FailAsTerminal,
        }
    }
}

#[napi(object)]
pub struct Awakeable {
    pub id: String,
    pub handle: u32,
}

#[napi(object)]
pub struct Run {
    pub replayed: bool,
    pub handle: u32,
}

#[napi(object)]
pub struct CallHandle {
    #[napi(js_name = "invocation_id_completion_id")]
    pub invocation_id_completion_id: u32,
    #[napi(js_name = "call_completion_id")]
    pub call_completion_id: u32,
}

impl From<CoreCallHandle> for CallHandle {
    fn from(value: CoreCallHandle) -> Self {
        CallHandle {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
            call_completion_id: value.call_notification_handle.into(),
        }
    }
}

#[napi(object)]
pub struct SendHandle {
    #[napi(js_name = "invocation_id_completion_id")]
    pub invocation_id_completion_id: u32,
}

impl From<CoreSendHandle> for SendHandle {
    fn from(value: CoreSendHandle) -> Self {
        SendHandle {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
        }
    }
}

// ---------------------------------------------------------------------------
// Tagged unions
// ---------------------------------------------------------------------------

/// Input to `do_progress`, deserialized from the externally-tagged JS object the SDK builds.
#[derive(Serialize, Deserialize)]
enum UnresolvedFutureInput {
    Single(u32),
    FirstCompleted(Vec<UnresolvedFutureInput>),
    AllCompleted(Vec<UnresolvedFutureInput>),
    FirstSucceededOrAllFailed(Vec<UnresolvedFutureInput>),
    AllSucceededOrFirstFailed(Vec<UnresolvedFutureInput>),
    Unknown(Vec<UnresolvedFutureInput>),
}

impl From<UnresolvedFutureInput> for CoreUnresolvedFuture {
    fn from(value: UnresolvedFutureInput) -> Self {
        fn conv(v: Vec<UnresolvedFutureInput>) -> Vec<CoreUnresolvedFuture> {
            v.into_iter().map(Into::into).collect()
        }
        match value {
            UnresolvedFutureInput::Single(h) => CoreUnresolvedFuture::Single(h.into()),
            UnresolvedFutureInput::FirstCompleted(c) => CoreUnresolvedFuture::FirstCompleted(conv(c)),
            UnresolvedFutureInput::AllCompleted(c) => CoreUnresolvedFuture::AllCompleted(conv(c)),
            UnresolvedFutureInput::FirstSucceededOrAllFailed(c) => {
                CoreUnresolvedFuture::FirstSucceededOrAllFailed(conv(c))
            }
            UnresolvedFutureInput::AllSucceededOrFirstFailed(c) => {
                CoreUnresolvedFuture::AllSucceededOrFirstFailed(conv(c))
            }
            UnresolvedFutureInput::Unknown(c) => CoreUnresolvedFuture::Unknown(conv(c)),
        }
    }
}

/// Builds the `DoProgressResult` JS value.
fn build_do_progress<'e>(env: &'e Env, resp: AwaitResponse) -> Result<Unknown<'e>> {
    match resp {
        AwaitResponse::AnyCompleted => to_unknown(env, "AnyCompleted".to_string()),
        AwaitResponse::WaitingExternalProgress { .. } => {
            to_unknown(env, "WaitExternalProgress".to_string())
        }
        AwaitResponse::ExecuteRun(n) => single_key_obj(env, "ExecuteRun", Into::<u32>::into(n)),
        AwaitResponse::CancelSignalReceived => to_unknown(env, "CancelSignalReceived".to_string()),
    }
}

/// Builds the `AsyncResultValue` JS value.
fn build_async_result<'e>(env: &'e Env, value: Option<Value>) -> Result<Unknown<'e>> {
    match value {
        None => to_unknown(env, "NotReady".to_string()),
        Some(Value::Void) => to_unknown(env, "Empty".to_string()),
        Some(Value::Success(b)) => single_key_obj(env, "Success", Uint8Array::new(b.to_vec())),
        Some(Value::Failure(f)) => single_key_obj(env, "Failure", Failure::from(f)),
        Some(Value::StateKeys(keys)) => single_key_obj(env, "StateKeys", keys),
        Some(Value::InvocationId(id)) => single_key_obj(env, "InvocationId", id),
    }
}

// ---------------------------------------------------------------------------
// VM
// ---------------------------------------------------------------------------

#[napi(js_name = "VM")]
pub struct VM {
    vm: CoreVM,
    log_dispatcher: Dispatch,
}

/// Run `$f` against the core VM under this VM's log dispatcher, then flush buffered logs.
macro_rules! with_vm {
    ($self:expr, $env:expr, $f:expr) => {{
        let VM { vm, log_dispatcher } = $self;
        let __r = tracing::dispatcher::with_default(log_dispatcher, || $f(vm));
        flush_logs($env);
        __r
    }};
}

#[napi]
impl VM {
    #[napi(constructor)]
    pub fn new(
        env: &Env,
        headers: Vec<&Header>,
        log_level: LogLevel,
        logger_id: u32,
        disable_payload_checks: bool,
        explicit_cancellation: bool,
        on_journal_mismatch: JournalMismatchBehavior,
    ) -> Result<Self> {
        ensure_panic_hook();
        let log_dispatcher = Dispatch::new(log_subscriber(log_level, Some(logger_id)));
        let header_list = HeaderList(header_pairs(&headers));

        let vm_res = tracing::dispatcher::with_default(&log_dispatcher, || {
            CoreVM::new(
                header_list,
                VMOptions {
                    non_determinism_checks: if disable_payload_checks {
                        NonDeterministicChecksOption::PayloadChecksDisabled
                    } else {
                        NonDeterministicChecksOption::Enabled
                    },
                    implicit_cancellation: if explicit_cancellation {
                        ImplicitCancellationOption::Disabled
                    } else {
                        ImplicitCancellationOption::Enabled {
                            cancel_children_calls: true,
                            cancel_children_one_way_calls: false,
                        }
                    },
                    awaiting_on_policy: Default::default(),
                    journal_mismatch_retry_behavior: on_journal_mismatch.into(),
                },
            )
        });
        flush_logs(env);

        match vm_res {
            Ok(vm) => Ok(VM { vm, log_dispatcher }),
            Err(e) => Err(throw_failure(env, e.into())),
        }
    }

    #[napi(js_name = "get_response_head")]
    pub fn get_response_head(&self, env: &Env) -> ResponseHead {
        with_vm!(self, env, |vm: &CoreVM| CoreVM::get_response_head(vm)).into()
    }

    #[napi(js_name = "notify_input")]
    pub fn notify_input(&mut self, env: &Env, buffer: Uint8Array) {
        let buf = buffer.to_vec().into();
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_input(vm, buf))
    }

    #[napi(js_name = "notify_input_closed")]
    pub fn notify_input_closed(&mut self, env: &Env) {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_input_closed(vm))
    }

    #[napi(js_name = "notify_error")]
    pub fn notify_error(&mut self, env: &Env, error_message: String, stacktrace: Option<String>) {
        let mut e = CoreError::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_error(vm, e, None))
    }

    #[napi(js_name = "notify_error_with_delay_override")]
    pub fn notify_error_with_delay_override(
        &mut self,
        env: &Env,
        error_message: String,
        stacktrace: Option<String>,
        delay_override: Option<BigInt>,
    ) {
        let mut e = CoreError::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        if let Some(delay_override) = delay_override {
            e = e.with_next_retry_delay_override(Duration::from_millis(delay_override.get_u64().1));
        }
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_error(vm, e, None))
    }

    #[napi(js_name = "notify_error_for_next_command")]
    pub fn notify_error_for_next_command(
        &mut self,
        env: &Env,
        error_message: String,
        stacktrace: Option<String>,
        wasm_command_type: CommandType,
    ) {
        let mut e = CoreError::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_error(
            vm,
            e,
            Some(CommandRelationship::Next {
                ty: wasm_command_type.into(),
                name: None,
            })
        ))
    }

    #[napi(js_name = "notify_error_for_specific_command")]
    pub fn notify_error_for_specific_command(
        &mut self,
        env: &Env,
        error_message: String,
        stacktrace: Option<String>,
        wasm_command_type: CommandType,
        command_index: u32,
        command_name: Option<String>,
    ) {
        let mut e = CoreError::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::notify_error(
            vm,
            e,
            Some(CommandRelationship::Specific {
                command_index,
                ty: wasm_command_type.into(),
                name: command_name.map(Into::into),
            })
        ))
    }

    #[napi(js_name = "take_output")]
    pub fn take_output(&mut self, env: &Env) -> Uint8Array {
        let out = with_vm!(self, env, |vm: &mut CoreVM| CoreVM::take_output(vm));
        Uint8Array::new((*out).to_vec())
    }

    #[napi(js_name = "is_ready_to_execute")]
    pub fn is_ready_to_execute(&self, env: &Env) -> Result<bool> {
        with_vm!(self, env, |vm: &CoreVM| CoreVM::is_ready_to_execute(vm))
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "is_completed")]
    pub fn is_completed(&self, env: &Env, handle: u32) -> bool {
        with_vm!(self, env, |vm: &CoreVM| CoreVM::is_completed(vm, handle.into()))
    }

    #[napi(js_name = "do_progress", ts_args_type = "future: any", ts_return_type = "any")]
    pub fn do_progress<'e>(&mut self, env: &'e Env, future: Unknown) -> Result<Unknown<'e>> {
        let parsed: UnresolvedFutureInput = env.from_js_value(future)?;
        let core_future: CoreUnresolvedFuture = parsed.into();
        let r = with_vm!(self, env, |vm: &mut CoreVM| CoreVM::do_await(vm, core_future));
        match r {
            Ok(resp) => build_do_progress(env, resp),
            Err(e) => Err(throw_failure(env, e.into())),
        }
    }

    #[napi(js_name = "take_notification", ts_return_type = "any")]
    pub fn take_notification<'e>(&mut self, env: &'e Env, handle: u32) -> Result<Unknown<'e>> {
        let r = with_vm!(self, env, |vm: &mut CoreVM| CoreVM::take_notification(
            vm,
            handle.into()
        ));
        match r {
            Ok(v) => build_async_result(env, v),
            Err(e) => Err(throw_failure(env, e.into())),
        }
    }

    // --- Syscalls ---

    #[napi(js_name = "sys_input")]
    pub fn sys_input(&mut self, env: &Env) -> Result<Input> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_input(vm))
            .map(Input::from)
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_get_state")]
    pub fn sys_get_state(&mut self, env: &Env, key: String) -> Result<u32> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_state_get(
            vm,
            key,
            Default::default()
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_get_state_keys")]
    pub fn sys_get_state_keys(&mut self, env: &Env) -> Result<u32> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_state_get_keys(vm))
            .map(Into::into)
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_set_state")]
    pub fn sys_set_state(&mut self, env: &Env, key: String, buffer: Uint8Array) -> Result<()> {
        let buf = buffer.to_vec().into();
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_state_set(
            vm,
            key,
            buf,
            Default::default()
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_clear_state")]
    pub fn sys_clear_state(&mut self, env: &Env, key: String) -> Result<()> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_state_clear(vm, key))
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_clear_all_state")]
    pub fn sys_clear_all_state(&mut self, env: &Env) -> Result<()> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_state_clear_all(vm))
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_sleep")]
    pub fn sys_sleep(&mut self, env: &Env, millis: BigInt, name: Option<String>) -> Result<u32> {
        let now = now_since_unix_epoch();
        let wake = now + Duration::from_millis(millis.get_u64().1);
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_sleep(
            vm,
            name.unwrap_or_default(),
            wake,
            Some(now)
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_attach_invocation")]
    pub fn sys_attach_invocation(&mut self, env: &Env, invocation_id: String) -> Result<u32> {
        let target = AttachInvocationTarget::InvocationId(invocation_id);
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_attach_invocation(
            vm, target
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_get_invocation_output")]
    pub fn sys_get_invocation_output(&mut self, env: &Env, invocation_id: String) -> Result<u32> {
        let target = AttachInvocationTarget::InvocationId(invocation_id);
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_get_invocation_output(
            vm, target
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[allow(clippy::too_many_arguments)]
    #[napi(js_name = "sys_call")]
    pub fn sys_call(
        &mut self,
        env: &Env,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        headers: Vec<&Header>,
        idempotency_key: Option<String>,
        scope: Option<String>,
        limit_key: Option<String>,
        name: Option<String>,
    ) -> Result<CallHandle> {
        let target = Target {
            service,
            handler,
            key,
            idempotency_key,
            scope,
            limit_key,
            headers: headers.iter().map(|h| to_core_header(h)).collect(),
        };
        let input = buffer.to_vec().into();
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_call(
            vm,
            target,
            input,
            name,
            Default::default()
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[allow(clippy::too_many_arguments)]
    #[napi(js_name = "sys_send")]
    pub fn sys_send(
        &mut self,
        env: &Env,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        headers: Vec<&Header>,
        delay: Option<BigInt>,
        idempotency_key: Option<String>,
        scope: Option<String>,
        limit_key: Option<String>,
        name: Option<String>,
    ) -> Result<SendHandle> {
        let target = Target {
            service,
            handler,
            key,
            idempotency_key,
            scope,
            limit_key,
            headers: headers.iter().map(|h| to_core_header(h)).collect(),
        };
        let input = buffer.to_vec().into();
        let execution_time =
            delay.map(|d| now_since_unix_epoch() + Duration::from_millis(d.get_u64().1));
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_send(
            vm,
            target,
            input,
            execution_time,
            name,
            Default::default()
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_awakeable")]
    pub fn sys_awakeable(&mut self, env: &Env) -> Result<Awakeable> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_awakeable(vm))
            .map(|AwakeableHandle { id, handle }| Awakeable {
                id,
                handle: handle.into(),
            })
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_awakeable_success")]
    pub fn sys_complete_awakeable_success(
        &mut self,
        env: &Env,
        id: String,
        buffer: Uint8Array,
    ) -> Result<()> {
        let value = NonEmptyValue::Success(buffer.to_vec().into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_awakeable(
            vm,
            id,
            value,
            Default::default()
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_awakeable_failure")]
    pub fn sys_complete_awakeable_failure(
        &mut self,
        env: &Env,
        id: String,
        value: Failure,
    ) -> Result<()> {
        let value = NonEmptyValue::Failure(value.into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_awakeable(
            vm,
            id,
            value,
            Default::default()
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_signal")]
    pub fn sys_signal(&mut self, env: &Env, signal_name: String) -> Result<u32> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::create_signal_handle(
            vm,
            signal_name
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_signal_success")]
    pub fn sys_complete_signal_success(
        &mut self,
        env: &Env,
        invocation_id: String,
        signal_name: String,
        buffer: Uint8Array,
    ) -> Result<()> {
        let value = NonEmptyValue::Success(buffer.to_vec().into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_signal(
            vm,
            invocation_id,
            signal_name,
            value
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_signal_failure")]
    pub fn sys_complete_signal_failure(
        &mut self,
        env: &Env,
        invocation_id: String,
        signal_name: String,
        value: Failure,
    ) -> Result<()> {
        let value = NonEmptyValue::Failure(value.into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_signal(
            vm,
            invocation_id,
            signal_name,
            value
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_get_promise")]
    pub fn sys_get_promise(&mut self, env: &Env, key: String) -> Result<u32> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_get_promise(vm, key))
            .map(Into::into)
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_peek_promise")]
    pub fn sys_peek_promise(&mut self, env: &Env, key: String) -> Result<u32> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_peek_promise(vm, key))
            .map(Into::into)
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_promise_success")]
    pub fn sys_complete_promise_success(
        &mut self,
        env: &Env,
        key: String,
        buffer: Uint8Array,
    ) -> Result<u32> {
        let value = NonEmptyValue::Success(buffer.to_vec().into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_promise(
            vm,
            key,
            value,
            Default::default()
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_complete_promise_failure")]
    pub fn sys_complete_promise_failure(
        &mut self,
        env: &Env,
        key: String,
        value: Failure,
    ) -> Result<u32> {
        let value = NonEmptyValue::Failure(value.into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_complete_promise(
            vm,
            key,
            value,
            Default::default()
        ))
        .map(Into::into)
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_run")]
    pub fn sys_run(&mut self, env: &Env, name: String) -> Result<Run> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_run(vm, name))
            .map(|RunHandle { replayed, handle }| Run {
                replayed,
                handle: handle.into(),
            })
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_success")]
    pub fn propose_run_completion_success(
        &mut self,
        env: &Env,
        handle: u32,
        buffer: Uint8Array,
    ) -> Result<()> {
        let result = RunExitResult::Success(buffer.to_vec().into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            result,
            RetryPolicy::None
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure")]
    pub fn propose_run_completion_failure(
        &mut self,
        env: &Env,
        handle: u32,
        value: Failure,
    ) -> Result<()> {
        let result = RunExitResult::TerminalFailure(value.into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            result,
            RetryPolicy::None
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure_transient")]
    pub fn propose_run_completion_failure_transient(
        &mut self,
        env: &Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
        config: Option<ExponentialRetryConfig>,
    ) -> Result<()> {
        let result = RunExitResult::RetryableFailure {
            attempt_duration: Duration::from_millis(attempt_duration.get_u64().1),
            error: CoreError::internal(error_message)
                .with_stacktrace(error_stacktrace.unwrap_or_default()),
        };
        let retry_policy = config.map(Into::into).unwrap_or(RetryPolicy::Infinite);
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            result,
            retry_policy
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[allow(clippy::too_many_arguments)]
    #[napi(js_name = "propose_run_completion_failure_transient_with_delay_override")]
    pub fn propose_run_completion_failure_transient_with_delay_override(
        &mut self,
        env: &Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
        delay_override: Option<BigInt>,
        max_retry_attempts_override: Option<u32>,
        max_retry_duration_override: Option<BigInt>,
    ) -> Result<()> {
        let retry_policy = if delay_override.is_some()
            || max_retry_attempts_override.is_some()
            || max_retry_duration_override.is_some()
        {
            RetryPolicy::FixedDelay {
                interval: delay_override.map(|d| Duration::from_millis(d.get_u64().1)),
                max_attempts: max_retry_attempts_override,
                max_duration: max_retry_duration_override
                    .map(|d| Duration::from_millis(d.get_u64().1)),
                on_max_attempts: OnMaxAttempts::FailAsTerminal,
            }
        } else {
            RetryPolicy::Infinite
        };
        let result = RunExitResult::RetryableFailure {
            attempt_duration: Duration::from_millis(attempt_duration.get_u64().1),
            error: CoreError::internal(error_message)
                .with_stacktrace(error_stacktrace.unwrap_or_default()),
        };
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            result,
            retry_policy
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure_transient_with_pause")]
    pub fn propose_run_completion_failure_transient_with_pause(
        &mut self,
        env: &Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
    ) -> Result<()> {
        let result = RunExitResult::RetryableFailure {
            attempt_duration: Duration::from_millis(attempt_duration.get_u64().1),
            error: CoreError::internal(error_message)
                .with_stacktrace(error_stacktrace.unwrap_or_default())
                .with_should_pause(true),
        };
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::propose_run_completion(
            vm,
            handle.into(),
            result,
            RetryPolicy::Infinite
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_cancel_invocation")]
    pub fn sys_cancel_invocation(&mut self, env: &Env, target_invocation_id: String) -> Result<()> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_cancel_invocation(
            vm,
            target_invocation_id
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_write_output_success")]
    pub fn sys_write_output_success(&mut self, env: &Env, buffer: Uint8Array) -> Result<()> {
        let value = NonEmptyValue::Success(buffer.to_vec().into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_write_output(
            vm,
            value,
            Default::default()
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_write_output_failure")]
    pub fn sys_write_output_failure(&mut self, env: &Env, value: Failure) -> Result<()> {
        let value = NonEmptyValue::Failure(value.into());
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_write_output(
            vm,
            value,
            Default::default()
        ))
        .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "sys_end")]
    pub fn sys_end(&mut self, env: &Env) -> Result<()> {
        with_vm!(self, env, |vm: &mut CoreVM| CoreVM::sys_end(vm))
            .map_err(|e| throw_failure(env, e.into()))
    }

    #[napi(js_name = "is_processing")]
    pub fn is_processing(&self, env: &Env) -> bool {
        with_vm!(self, env, |vm: &CoreVM| CoreVM::state(vm).is_processing())
    }

    #[napi(js_name = "last_command_index")]
    pub fn last_command_index(&self, env: &Env) -> i32 {
        with_vm!(self, env, |vm: &CoreVM| CoreVM::last_command_index(vm) as i32)
    }
}

// ---------------------------------------------------------------------------
// CoreHeader map + identity verifier
// ---------------------------------------------------------------------------

struct HeaderList(Vec<(String, String)>);

impl HeaderMap for HeaderList {
    type Error = Infallible;

    fn extract(&self, name: &str) -> std::result::Result<Option<&str>, Self::Error> {
        for (key, value) in &self.0 {
            if key.eq_ignore_ascii_case(name) {
                return Ok(Some(value));
            }
        }
        Ok(None)
    }
}

#[napi]
pub struct IdentityVerifier {
    identity_verifier: CoreIdentityVerifier,
}

#[napi]
impl IdentityVerifier {
    #[napi(constructor)]
    pub fn new(keys: Vec<String>) -> Result<Self> {
        let k: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        let identity_verifier =
            CoreIdentityVerifier::new(&k).map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(IdentityVerifier { identity_verifier })
    }

    #[napi(js_name = "verify_identity")]
    pub fn verify_identity(&self, path: String, headers: Vec<&Header>) -> Result<()> {
        let list = HeaderList(header_pairs(&headers));
        self.identity_verifier
            .verify_identity(&list, &path)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(())
    }
}

#[napi(js_name = "cancel_handle")]
pub fn cancel_handle() -> u32 {
    CANCEL_NOTIFICATION_HANDLE.into()
}
