// Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate SDK for Node.js/TypeScript,
// which is released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
//
// napi-rs port of `sdk-shared-core-wasm-bindings/src/lib.rs`. This exposes the
// exact same JS surface as the WASM binding (see
// `packages/libs/restate-sdk/src/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.d.ts`)
// so that @restatedev/restate-sdk can swap the two transparently on Node.
// Keep this in lockstep with the WASM binding to preserve functional parity.

use napi::bindgen_prelude::{BigInt, Buffer, FromNapiValue, ToNapiValue, Uint8Array};
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{Env, JsFunction, JsUnknown};
use napi_derive::napi;
use restate_sdk_shared_core::tracing_pretty::{Pretty, PrettyFields};
use restate_sdk_shared_core::{
    AwaitResponse, AwakeableHandle, CallHandle, CommandRelationship, CommandType, CoreVM, Error,
    Header, HeaderMap, IdentityVerifier, ImplicitCancellationOption, Input,
    JournalMismatchRetryBehavior, NonDeterministicChecksOption, NonEmptyValue, OnMaxAttempts,
    ResponseHead, RetryPolicy, RunExitResult, RunHandle, SendHandle, Target, TerminalFailure,
    UnresolvedFuture, VMOptions, Value, CANCEL_NOTIFICATION_HANDLE, VM,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::io::Write;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::metadata::LevelFilter;
use tracing::{Dispatch, Level, Subscriber};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};

// --- Logging bridge -------------------------------------------------------
//
// The WASM binding statically imports `vm_log`/`fatal` from `core_logging.js`
// via wasm-bindgen `raw_module`. napi has no static JS import, so the SDK
// registers these callbacks once at startup through `registerLogCallbacks`.
// They are stored as threadsafe functions and invoked (non-blocking) from the
// tracing writer and the panic hook.

struct LogRecord {
    level: u32,
    message: Vec<u8>,
    logger_id: Option<u32>,
}

static VM_LOG: OnceLock<ThreadsafeFunction<LogRecord, ErrorStrategy::Fatal>> = OnceLock::new();
static FATAL: OnceLock<ThreadsafeFunction<String, ErrorStrategy::Fatal>> = OnceLock::new();

#[napi(js_name = "registerLogCallbacks")]
pub fn register_log_callbacks(
    env: Env,
    vm_log: JsFunction,
    fatal: JsFunction,
) -> napi::Result<()> {
    let mut vm_log_tsfn: ThreadsafeFunction<LogRecord, ErrorStrategy::Fatal> = vm_log
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<LogRecord>| {
            let level = ctx.env.create_uint32(ctx.value.level)?;
            let message = ctx.env.create_buffer_with_data(ctx.value.message)?.into_raw();
            let logger_id = match ctx.value.logger_id {
                Some(id) => ctx.env.create_uint32(id)?.into_unknown(),
                None => ctx.env.get_undefined()?.into_unknown(),
            };
            Ok(vec![
                level.into_unknown(),
                message.into_unknown(),
                logger_id,
            ])
        })?;
    // Don't let logging keep the Node process alive.
    vm_log_tsfn.unref(&env)?;
    let _ = VM_LOG.set(vm_log_tsfn);

    let mut fatal_tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> = fatal
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
            Ok(vec![ctx.env.create_string(&ctx.value)?])
        })?;
    fatal_tsfn.unref(&env)?;
    let _ = FATAL.set(fatal_tsfn);

    // Install the panic hook now that `fatal` is available.
    std::panic::set_hook(Box::new(|info| {
        if let Some(f) = FATAL.get() {
            let _ = f.call(info.to_string(), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }));

    Ok(())
}

/// Setups the native module. Kept for API parity with the WASM binding; the
/// panic hook is installed by `registerLogCallbacks`.
#[napi(js_name = "start")]
pub fn start() {}

#[napi(js_name = "LogLevel")]
pub enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
}

fn log_level_to_tracing(level: &LogLevel) -> Level {
    match level {
        LogLevel::TRACE => Level::TRACE,
        LogLevel::DEBUG => Level::DEBUG,
        LogLevel::INFO => Level::INFO,
        LogLevel::WARN => Level::WARN,
        LogLevel::ERROR => Level::ERROR,
    }
}

fn tracing_to_log_level_u32(level: Level) -> u32 {
    match level {
        Level::TRACE => 0,
        Level::DEBUG => 1,
        Level::INFO => 2,
        Level::WARN => 3,
        Level::ERROR => 4,
    }
}

/// How the state machine should behave when it hits a journal mismatch (non-determinism) error.
#[napi(js_name = "WasmJournalMismatchBehavior")]
pub enum WasmJournalMismatchBehavior {
    /// Follow the normal retry policy.
    Retry = 0,
    /// Pause the invocation instead of retrying.
    Pause = 1,
    /// Fail the invocation terminally instead of retrying.
    Fail = 2,
}

impl From<WasmJournalMismatchBehavior> for JournalMismatchRetryBehavior {
    fn from(value: WasmJournalMismatchBehavior) -> Self {
        match value {
            WasmJournalMismatchBehavior::Retry => Self::FollowRetryPolicy,
            WasmJournalMismatchBehavior::Pause => Self::Pause,
            WasmJournalMismatchBehavior::Fail => Self::FailTerminally,
        }
    }
}

pub struct MakeWebConsoleWriter {
    logger_id: Option<u32>,
}

impl<'a> MakeWriter<'a> for MakeWebConsoleWriter {
    type Writer = ConsoleWriter;

    fn make_writer(&'a self) -> Self::Writer {
        ConsoleWriter {
            buffer: vec![],
            level: Level::TRACE,
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
        if let Some(tsfn) = VM_LOG.get() {
            // Remove last character, which is always a new line
            let end = self.buffer.len().saturating_sub(1);
            let _ = tsfn.call(
                LogRecord {
                    level: tracing_to_log_level_u32(self.level),
                    message: self.buffer[..end].to_vec(),
                    logger_id: self.logger_id,
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }
}

/// This will set the log level of the overall log subscriber.
#[napi(js_name = "set_log_level")]
pub fn set_log_level(level: LogLevel) {
    let _ = tracing::subscriber::set_global_default(log_subscriber(level, None));
}

fn log_subscriber(
    level: LogLevel,
    logger_id: Option<u32>,
) -> impl Subscriber + Send + Sync + 'static {
    let level = log_level_to_tracing(&level);

    let fmt_layer = if level == Level::TRACE {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .without_time()
            .with_span_events(FmtSpan::ENTER)
            .with_writer(MakeWebConsoleWriter { logger_id })
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
            .with_writer(MakeWebConsoleWriter { logger_id })
            .boxed()
    };

    Registry::default().with(fmt_layer.with_filter(LevelFilter::from_level(level)))
}

// --- Data model -----------------------------------------------------------

#[napi(js_name = "WasmCommandType")]
pub enum WasmCommandType {
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

impl From<WasmCommandType> for CommandType {
    fn from(value: WasmCommandType) -> Self {
        match value {
            WasmCommandType::Input => CommandType::Input,
            WasmCommandType::Output => CommandType::Output,
            WasmCommandType::GetState => CommandType::GetState,
            WasmCommandType::GetStateKeys => CommandType::GetStateKeys,
            WasmCommandType::SetState => CommandType::SetState,
            WasmCommandType::ClearState => CommandType::ClearState,
            WasmCommandType::ClearAllState => CommandType::ClearAllState,
            WasmCommandType::GetPromise => CommandType::GetPromise,
            WasmCommandType::PeekPromise => CommandType::PeekPromise,
            WasmCommandType::CompletePromise => CommandType::CompletePromise,
            WasmCommandType::Sleep => CommandType::Sleep,
            WasmCommandType::Call => CommandType::Call,
            WasmCommandType::OneWayCall => CommandType::OneWayCall,
            WasmCommandType::SendSignal => CommandType::SendSignal,
            WasmCommandType::Run => CommandType::Run,
            WasmCommandType::AttachInvocation => CommandType::AttachInvocation,
            WasmCommandType::GetInvocationOutput => CommandType::GetInvocationOutput,
            WasmCommandType::CompleteAwakeable => CommandType::CompleteAwakeable,
            WasmCommandType::CancelInvocation => CommandType::CancelInvocation,
        }
    }
}

/// A `key`/`value` header. Exposed as a class so the SDK can do
/// `new vm.WasmHeader(k, v)` exactly like with the WASM binding. Header arrays
/// crossing the boundary use the plain [`WasmHeaderData`] object, into which a
/// `WasmHeader` instance is structurally extracted.
#[napi(js_name = "WasmHeader")]
pub struct WasmHeader {
    pub key: String,
    pub value: String,
}

#[napi]
impl WasmHeader {
    #[napi(constructor)]
    pub fn new(key: String, value: String) -> WasmHeader {
        WasmHeader { key, value }
    }
}

/// Plain `{ key, value }` object used for header arrays in and out of the VM.
#[napi(object, js_name = "WasmHeaderData")]
#[derive(Clone)]
pub struct WasmHeaderData {
    pub key: String,
    pub value: String,
}

impl From<Header> for WasmHeaderData {
    fn from(h: Header) -> Self {
        WasmHeaderData {
            key: h.key.into(),
            value: h.value.into(),
        }
    }
}

impl From<WasmHeaderData> for Header {
    fn from(h: WasmHeaderData) -> Self {
        Header {
            key: h.key.into(),
            value: h.value.into(),
        }
    }
}

#[napi(object, js_name = "WasmResponseHead")]
pub struct WasmResponseHead {
    #[napi(js_name = "status_code")]
    pub status_code: u16,
    pub headers: Vec<WasmHeaderData>,
}

impl From<ResponseHead> for WasmResponseHead {
    fn from(value: ResponseHead) -> Self {
        WasmResponseHead {
            status_code: value.status_code,
            headers: value.headers.into_iter().map(Into::into).collect(),
        }
    }
}

#[napi(object, js_name = "WasmFailureMetadata")]
#[derive(Clone, Serialize, Deserialize)]
pub struct WasmFailureMetadata {
    pub key: String,
    pub value: String,
}

#[napi(object, js_name = "WasmFailure")]
#[derive(Clone, Serialize, Deserialize)]
pub struct WasmFailure {
    pub code: u16,
    pub message: String,
    pub metadata: Vec<WasmFailureMetadata>,
}

impl From<Error> for WasmFailure {
    fn from(value: Error) -> Self {
        WasmFailure {
            code: value.code(),
            message: value.to_string(),
            metadata: vec![],
        }
    }
}

impl From<TerminalFailure> for WasmFailure {
    fn from(value: TerminalFailure) -> Self {
        WasmFailure {
            code: value.code,
            message: value.message,
            metadata: value
                .metadata
                .into_iter()
                .map(|(k, v)| WasmFailureMetadata { key: k, value: v })
                .collect(),
        }
    }
}

impl From<WasmFailure> for TerminalFailure {
    fn from(value: WasmFailure) -> Self {
        TerminalFailure {
            code: value.code,
            message: value.message,
            metadata: value
                .metadata
                .into_iter()
                .map(|metadata| (metadata.key, metadata.value))
                .collect(),
        }
    }
}

/// Retry config. Millisecond fields are `number` (f64) to match the WASM
/// binding's tsify representation (the VM method millis are `bigint`, but this
/// nested object uses `number`).
#[napi(object, js_name = "WasmExponentialRetryConfig")]
pub struct WasmExponentialRetryConfig {
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

impl From<WasmExponentialRetryConfig> for RetryPolicy {
    fn from(value: WasmExponentialRetryConfig) -> Self {
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

#[napi(object, js_name = "WasmAwakeable")]
pub struct WasmAwakeable {
    pub id: String,
    pub handle: u32,
}

#[napi(object, js_name = "WasmRun")]
pub struct WasmRun {
    pub replayed: bool,
    pub handle: u32,
}

#[napi(object, js_name = "WasmCallHandle")]
pub struct WasmCallHandle {
    #[napi(js_name = "invocation_id_completion_id")]
    pub invocation_id_completion_id: u32,
    #[napi(js_name = "call_completion_id")]
    pub call_completion_id: u32,
}

impl From<CallHandle> for WasmCallHandle {
    fn from(value: CallHandle) -> Self {
        Self {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
            call_completion_id: value.call_notification_handle.into(),
        }
    }
}

#[napi(object, js_name = "WasmSendHandle")]
pub struct WasmSendHandle {
    #[napi(js_name = "invocation_id_completion_id")]
    pub invocation_id_completion_id: u32,
}

impl From<SendHandle> for WasmSendHandle {
    fn from(value: SendHandle) -> Self {
        Self {
            invocation_id_completion_id: value.invocation_id_notification_handle.into(),
        }
    }
}

#[napi(object, js_name = "WasmInput")]
pub struct WasmInput {
    #[napi(js_name = "invocation_id")]
    pub invocation_id: String,
    pub key: String,
    #[napi(js_name = "idempotency_key")]
    pub idempotency_key: Option<String>,
    pub scope: Option<String>,
    #[napi(js_name = "limit_key")]
    pub limit_key: Option<String>,
    pub headers: Vec<WasmHeaderData>,
    pub input: Buffer,
    #[napi(js_name = "random_seed")]
    pub random_seed: BigInt,
}

impl From<Input> for WasmInput {
    fn from(value: Input) -> Self {
        WasmInput {
            invocation_id: value.invocation_id,
            key: value.key,
            idempotency_key: value.idempotency_key,
            scope: value.scope,
            limit_key: value.limit_key,
            headers: value.headers.into_iter().map(Into::into).collect(),
            input: Buffer::from(value.input.to_vec()),
            random_seed: BigInt::from(value.random_seed),
        }
    }
}

/// Input-only recursive future tree. Deserialized from the JS object via serde
/// (the shape has no binary payloads, so it round-trips through serde_json).
#[derive(Deserialize)]
pub enum WasmUnresolvedFuture {
    Single(u32),
    FirstCompleted(Vec<WasmUnresolvedFuture>),
    AllCompleted(Vec<WasmUnresolvedFuture>),
    FirstSucceededOrAllFailed(Vec<WasmUnresolvedFuture>),
    AllSucceededOrFirstFailed(Vec<WasmUnresolvedFuture>),
    Unknown(Vec<WasmUnresolvedFuture>),
}

impl From<WasmUnresolvedFuture> for UnresolvedFuture {
    fn from(value: WasmUnresolvedFuture) -> Self {
        match value {
            WasmUnresolvedFuture::Single(h) => UnresolvedFuture::Single(h.into()),
            WasmUnresolvedFuture::FirstCompleted(c) => {
                UnresolvedFuture::FirstCompleted(c.into_iter().map(Into::into).collect())
            }
            WasmUnresolvedFuture::AllCompleted(c) => {
                UnresolvedFuture::AllCompleted(c.into_iter().map(Into::into).collect())
            }
            WasmUnresolvedFuture::FirstSucceededOrAllFailed(c) => {
                UnresolvedFuture::FirstSucceededOrAllFailed(c.into_iter().map(Into::into).collect())
            }
            WasmUnresolvedFuture::AllSucceededOrFirstFailed(c) => {
                UnresolvedFuture::AllSucceededOrFirstFailed(c.into_iter().map(Into::into).collect())
            }
            WasmUnresolvedFuture::Unknown(c) => {
                UnresolvedFuture::Unknown(c.into_iter().map(Into::into).collect())
            }
        }
    }
}

// --- Helpers --------------------------------------------------------------

fn now_since_unix_epoch() -> Duration {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
}

fn bigint_to_u64(b: BigInt) -> u64 {
    b.words.first().copied().unwrap_or(0)
}

/// Throws a plain `{ code, message, metadata }` object (NOT a JS `Error`), so
/// the SDK's `ensureError` recognizes it as a VM failure. Returns a
/// `PendingException` error so napi propagates the already-thrown value.
fn throw_failure(env: &Env, f: WasmFailure) -> napi::Error {
    let thrown = (|| -> napi::Result<()> {
        let raw = unsafe { WasmFailure::to_napi_value(env.raw(), f)? };
        let value = unsafe { <JsUnknown as FromNapiValue>::from_napi_value(env.raw(), raw)? };
        env.throw(value)
    })();
    match thrown {
        Ok(()) => napi::Error::new(napi::Status::PendingException, String::new()),
        Err(e) => e,
    }
}

fn to_unknown<T: ToNapiValue>(env: &Env, value: T) -> napi::Result<JsUnknown> {
    let raw = unsafe { T::to_napi_value(env.raw(), value)? };
    Ok(unsafe { <JsUnknown as FromNapiValue>::from_napi_value(env.raw(), raw)? })
}

/// Builds a single-key object `{ tag: value }` (serde external tagging shape).
fn tagged<T: ToNapiValue>(env: &Env, tag: &str, value: T) -> napi::Result<JsUnknown> {
    let mut obj = env.create_object()?;
    let jsval = to_unknown(env, value)?;
    obj.set_named_property(tag, jsval)?;
    Ok(obj.into_unknown())
}

// We need this wrapper for the shared core
struct WasmHeaderList(Vec<WasmHeaderData>);

impl HeaderMap for WasmHeaderList {
    type Error = Infallible;

    fn extract(&self, name: &str) -> Result<Option<&str>, Self::Error> {
        for WasmHeaderData { key, value } in &self.0 {
            if key.eq_ignore_ascii_case(name) {
                return Ok(Some(value));
            }
        }
        Ok(None)
    }
}

// --- VM implementation ----------------------------------------------------

#[napi(js_name = "WasmVM")]
pub struct WasmVM {
    vm: CoreVM,
    log_dispatcher: Dispatch,
}

impl WasmVM {
    fn with_dispatcher<R>(&self, f: impl FnOnce(&CoreVM) -> R) -> R {
        tracing::dispatcher::with_default(&self.log_dispatcher, || f(&self.vm))
    }

    fn with_dispatcher_mut<R>(&mut self, f: impl FnOnce(&mut CoreVM) -> R) -> R {
        let dispatcher = self.log_dispatcher.clone();
        tracing::dispatcher::with_default(&dispatcher, || f(&mut self.vm))
    }
}

#[napi]
impl WasmVM {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        headers: Vec<WasmHeaderData>,
        log_level: LogLevel,
        logger_id: u32,
        disable_payload_checks: bool,
        explicit_cancellation: bool,
        on_journal_mismatch: WasmJournalMismatchBehavior,
    ) -> napi::Result<WasmVM> {
        let log_dispatcher = Dispatch::new(log_subscriber(log_level, Some(logger_id)));

        let vm = tracing::dispatcher::with_default(&log_dispatcher, || {
            CoreVM::new(
                WasmHeaderList(headers),
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

        match vm {
            Ok(vm) => Ok(WasmVM { vm, log_dispatcher }),
            Err(e) => Err(throw_failure(&env, e.into())),
        }
    }

    #[napi(js_name = "get_response_head")]
    pub fn get_response_head(&self) -> WasmResponseHead {
        self.with_dispatcher(|vm| CoreVM::get_response_head(vm)).into()
    }

    #[napi(js_name = "notify_input")]
    pub fn notify_input(&mut self, buffer: Uint8Array) {
        let buf = buffer.to_vec().into();
        self.with_dispatcher_mut(|vm| CoreVM::notify_input(vm, buf))
    }

    #[napi(js_name = "notify_input_closed")]
    pub fn notify_input_closed(&mut self) {
        self.vm.notify_input_closed();
    }

    #[napi(js_name = "notify_error")]
    pub fn notify_error(&mut self, error_message: String, stacktrace: Option<String>) {
        let mut e = Error::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        self.with_dispatcher_mut(|vm| CoreVM::notify_error(vm, e, None))
    }

    #[napi(js_name = "notify_error_with_delay_override")]
    pub fn notify_error_with_delay_override(
        &mut self,
        error_message: String,
        stacktrace: Option<String>,
        delay_override: Option<BigInt>,
    ) {
        let mut e = Error::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        if let Some(delay_override) = delay_override {
            e = e.with_next_retry_delay_override(Duration::from_millis(bigint_to_u64(delay_override)))
        }
        self.with_dispatcher_mut(|vm| CoreVM::notify_error(vm, e, None))
    }

    #[napi(js_name = "notify_error_for_next_command")]
    pub fn notify_error_for_next_command(
        &mut self,
        error_message: String,
        stacktrace: Option<String>,
        wasm_command_type: WasmCommandType,
    ) {
        let mut e = Error::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        self.with_dispatcher_mut(|vm| {
            CoreVM::notify_error(
                vm,
                e,
                Some(CommandRelationship::Next {
                    ty: wasm_command_type.into(),
                    name: None,
                }),
            )
        })
    }

    #[napi(js_name = "notify_error_for_specific_command")]
    pub fn notify_error_for_specific_command(
        &mut self,
        error_message: String,
        stacktrace: Option<String>,
        wasm_command_type: WasmCommandType,
        command_index: u32,
        command_name: Option<String>,
    ) {
        let mut e = Error::internal(error_message);
        if let Some(stacktrace) = stacktrace {
            e = e.with_stacktrace(stacktrace);
        }
        self.with_dispatcher_mut(|vm| {
            CoreVM::notify_error(
                vm,
                e,
                Some(CommandRelationship::Specific {
                    command_index,
                    ty: wasm_command_type.into(),
                    name: command_name.map(Into::into),
                }),
            )
        })
    }

    #[napi(js_name = "take_output")]
    pub fn take_output(&mut self) -> Buffer {
        Buffer::from(self.with_dispatcher_mut(CoreVM::take_output).to_vec())
    }

    #[napi(js_name = "is_ready_to_execute")]
    pub fn is_ready_to_execute(&self, env: Env) -> napi::Result<bool> {
        self.with_dispatcher(CoreVM::is_ready_to_execute)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "is_completed")]
    pub fn is_completed(&self, handle: u32) -> bool {
        self.with_dispatcher(|vm| CoreVM::is_completed(vm, handle.into()))
    }

    #[napi(js_name = "do_progress")]
    pub fn do_progress(
        &mut self,
        env: Env,
        future: serde_json::Value,
    ) -> napi::Result<JsUnknown> {
        let future: WasmUnresolvedFuture = serde_json::from_value(future)
            .map_err(|e| napi::Error::from_reason(format!("Invalid future: {e}")))?;
        match self.with_dispatcher_mut(|vm| CoreVM::do_await(vm, future.into())) {
            Ok(result) => match result {
                AwaitResponse::AnyCompleted => to_unknown(&env, "AnyCompleted".to_string()),
                AwaitResponse::WaitingExternalProgress { .. } => {
                    to_unknown(&env, "WaitExternalProgress".to_string())
                }
                AwaitResponse::ExecuteRun(n) => {
                    tagged(&env, "ExecuteRun", Into::<u32>::into(n))
                }
                AwaitResponse::CancelSignalReceived => {
                    to_unknown(&env, "CancelSignalReceived".to_string())
                }
            },
            Err(e) => Err(throw_failure(&env, e.into())),
        }
    }

    #[napi(js_name = "take_notification")]
    pub fn take_notification(
        &mut self,
        env: Env,
        handle: u32,
    ) -> napi::Result<JsUnknown> {
        match self.with_dispatcher_mut(|vm| CoreVM::take_notification(vm, handle.into())) {
            Ok(None) => to_unknown(&env, "NotReady".to_string()),
            Ok(Some(Value::Void)) => to_unknown(&env, "Empty".to_string()),
            Ok(Some(Value::Success(b))) => {
                let buffer = Buffer::from(b.to_vec());
                tagged(&env, "Success", buffer)
            }
            Ok(Some(Value::Failure(f))) => {
                let failure: WasmFailure = f.into();
                tagged(&env, "Failure", failure)
            }
            Ok(Some(Value::StateKeys(keys))) => tagged(&env, "StateKeys", keys),
            Ok(Some(Value::InvocationId(invocation_id))) => {
                tagged(&env, "InvocationId", invocation_id)
            }
            Err(e) => Err(throw_failure(&env, e.into())),
        }
    }

    // Syscall(s)

    #[napi(js_name = "sys_input")]
    pub fn sys_input(&mut self, env: Env) -> napi::Result<WasmInput> {
        self.with_dispatcher_mut(CoreVM::sys_input)
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_get_state")]
    pub fn sys_get_state(
        &mut self,
        env: Env,
        key: String,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_state_get(vm, key, Default::default()))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_get_state_keys")]
    pub fn sys_get_state_keys(&mut self, env: Env) -> napi::Result<u32> {
        self.with_dispatcher_mut(CoreVM::sys_state_get_keys)
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_set_state")]
    pub fn sys_set_state(&mut self, env: Env, key: String, buffer: Uint8Array) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_state_set(vm, key, buffer.to_vec().into(), Default::default())
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_clear_state")]
    pub fn sys_clear_state(&mut self, env: Env, key: String) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_state_clear(vm, key))
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_clear_all_state")]
    pub fn sys_clear_all_state(&mut self, env: Env) -> napi::Result<()> {
        self.with_dispatcher_mut(CoreVM::sys_state_clear_all)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_sleep")]
    pub fn sys_sleep(
        &mut self,
        env: Env,
        millis: BigInt,
        name: Option<String>,
    ) -> napi::Result<u32> {
        let now = now_since_unix_epoch();
        let millis = bigint_to_u64(millis);
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_sleep(
                vm,
                name.unwrap_or_default(),
                now + Duration::from_millis(millis),
                Some(now),
            )
        })
        .map(Into::into)
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_attach_invocation")]
    pub fn sys_attach_invocation(
        &mut self,
        env: Env,
        invocation_id: String,
    ) -> napi::Result<u32> {
        let target = restate_sdk_shared_core::AttachInvocationTarget::InvocationId(invocation_id);
        self.with_dispatcher_mut(|vm| CoreVM::sys_attach_invocation(vm, target))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_get_invocation_output")]
    pub fn sys_get_invocation_output(
        &mut self,
        env: Env,
        invocation_id: String,
    ) -> napi::Result<u32> {
        let target = restate_sdk_shared_core::AttachInvocationTarget::InvocationId(invocation_id);
        self.with_dispatcher_mut(|vm| CoreVM::sys_get_invocation_output(vm, target))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_call")]
    #[allow(clippy::too_many_arguments)]
    pub fn sys_call(
        &mut self,
        env: Env,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        headers: Vec<WasmHeaderData>,
        idempotency_key: Option<String>,
        scope: Option<String>,
        limit_key: Option<String>,
        name: Option<String>,
    ) -> napi::Result<WasmCallHandle> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_call(
                vm,
                Target {
                    service,
                    handler,
                    key,
                    idempotency_key,
                    scope,
                    limit_key,
                    headers: headers.into_iter().map(Header::from).collect(),
                },
                buffer.to_vec().into(),
                name,
                Default::default(),
            )
        })
        .map(Into::into)
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_send")]
    #[allow(clippy::too_many_arguments)]
    pub fn sys_send(
        &mut self,
        env: Env,
        service: String,
        handler: String,
        buffer: Uint8Array,
        key: Option<String>,
        headers: Vec<WasmHeaderData>,
        delay: Option<BigInt>,
        idempotency_key: Option<String>,
        scope: Option<String>,
        limit_key: Option<String>,
        name: Option<String>,
    ) -> napi::Result<WasmSendHandle> {
        let delay = delay.map(bigint_to_u64);
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_send(
                vm,
                Target {
                    service,
                    handler,
                    key,
                    idempotency_key,
                    scope,
                    limit_key,
                    headers: headers.into_iter().map(Header::from).collect(),
                },
                buffer.to_vec().into(),
                delay.map(|delay| now_since_unix_epoch() + Duration::from_millis(delay)),
                name,
                Default::default(),
            )
        })
        .map(Into::into)
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_awakeable")]
    pub fn sys_awakeable(&mut self, env: Env) -> napi::Result<WasmAwakeable> {
        self.with_dispatcher_mut(CoreVM::sys_awakeable)
            .map(|AwakeableHandle { id, handle }| WasmAwakeable {
                id,
                handle: handle.into(),
            })
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_awakeable_success")]
    pub fn sys_complete_awakeable_success(
        &mut self,
        env: Env,
        id: String,
        buffer: Uint8Array,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_awakeable(
                vm,
                id,
                NonEmptyValue::Success(buffer.to_vec().into()),
                Default::default(),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_awakeable_failure")]
    pub fn sys_complete_awakeable_failure(
        &mut self,
        env: Env,
        id: String,
        value: WasmFailure,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_awakeable(
                vm,
                id,
                NonEmptyValue::Failure(value.into()),
                Default::default(),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_signal")]
    pub fn sys_signal(
        &mut self,
        env: Env,
        signal_name: String,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| CoreVM::create_signal_handle(vm, signal_name))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_signal_success")]
    pub fn sys_complete_signal_success(
        &mut self,
        env: Env,
        invocation_id: String,
        signal_name: String,
        buffer: Uint8Array,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_signal(
                vm,
                invocation_id,
                signal_name,
                NonEmptyValue::Success(buffer.to_vec().into()),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_signal_failure")]
    pub fn sys_complete_signal_failure(
        &mut self,
        env: Env,
        invocation_id: String,
        signal_name: String,
        value: WasmFailure,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_signal(
                vm,
                invocation_id,
                signal_name,
                NonEmptyValue::Failure(value.into()),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_get_promise")]
    pub fn sys_get_promise(
        &mut self,
        env: Env,
        key: String,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_get_promise(vm, key))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_peek_promise")]
    pub fn sys_peek_promise(
        &mut self,
        env: Env,
        key: String,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_peek_promise(vm, key))
            .map(Into::into)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_promise_success")]
    pub fn sys_complete_promise_success(
        &mut self,
        env: Env,
        key: String,
        buffer: Uint8Array,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_promise(
                vm,
                key,
                NonEmptyValue::Success(buffer.to_vec().into()),
                Default::default(),
            )
        })
        .map(Into::into)
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_complete_promise_failure")]
    pub fn sys_complete_promise_failure(
        &mut self,
        env: Env,
        key: String,
        value: WasmFailure,
    ) -> napi::Result<u32> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_complete_promise(
                vm,
                key,
                NonEmptyValue::Failure(value.into()),
                Default::default(),
            )
        })
        .map(Into::into)
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_run")]
    pub fn sys_run(&mut self, env: Env, name: String) -> napi::Result<WasmRun> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_run(vm, name))
            .map(|RunHandle { replayed, handle }| WasmRun {
                replayed,
                handle: handle.into(),
            })
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_success")]
    pub fn propose_run_completion_success(
        &mut self,
        env: Env,
        handle: u32,
        buffer: Uint8Array,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::propose_run_completion(
                vm,
                handle.into(),
                RunExitResult::Success(buffer.to_vec().into()),
                RetryPolicy::None,
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure")]
    pub fn propose_run_completion_failure(
        &mut self,
        env: Env,
        handle: u32,
        value: WasmFailure,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::propose_run_completion(
                vm,
                handle.into(),
                RunExitResult::TerminalFailure(value.into()),
                RetryPolicy::None,
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure_transient")]
    pub fn propose_run_completion_failure_transient(
        &mut self,
        env: Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
        config: Option<WasmExponentialRetryConfig>,
    ) -> napi::Result<()> {
        let attempt_duration = bigint_to_u64(attempt_duration);
        self.with_dispatcher_mut(|vm| {
            CoreVM::propose_run_completion(
                vm,
                handle.into(),
                RunExitResult::RetryableFailure {
                    attempt_duration: Duration::from_millis(attempt_duration),
                    error: Error::internal(error_message)
                        .with_stacktrace(error_stacktrace.unwrap_or_default()),
                },
                config.map(|config| config.into()).unwrap_or(RetryPolicy::Infinite),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure_transient_with_delay_override")]
    #[allow(clippy::too_many_arguments)]
    pub fn propose_run_completion_failure_transient_with_delay_override(
        &mut self,
        env: Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
        delay_override: Option<BigInt>,
        max_retry_attempts_override: Option<u32>,
        max_retry_duration_override: Option<BigInt>,
    ) -> napi::Result<()> {
        let attempt_duration = bigint_to_u64(attempt_duration);
        let delay_override = delay_override.map(bigint_to_u64);
        let max_retry_duration_override = max_retry_duration_override.map(bigint_to_u64);
        let retry_policy = if delay_override.is_some()
            || max_retry_attempts_override.is_some()
            || max_retry_duration_override.is_some()
        {
            RetryPolicy::FixedDelay {
                interval: delay_override.map(Duration::from_millis),
                max_attempts: max_retry_attempts_override,
                max_duration: max_retry_duration_override.map(Duration::from_millis),
                on_max_attempts: OnMaxAttempts::FailAsTerminal,
            }
        } else {
            RetryPolicy::Infinite
        };
        self.with_dispatcher_mut(|vm| {
            CoreVM::propose_run_completion(
                vm,
                handle.into(),
                RunExitResult::RetryableFailure {
                    attempt_duration: Duration::from_millis(attempt_duration),
                    error: Error::internal(error_message)
                        .with_stacktrace(error_stacktrace.unwrap_or_default()),
                },
                retry_policy,
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "propose_run_completion_failure_transient_with_pause")]
    pub fn propose_run_completion_failure_transient_with_pause(
        &mut self,
        env: Env,
        handle: u32,
        error_message: String,
        error_stacktrace: Option<String>,
        attempt_duration: BigInt,
    ) -> napi::Result<()> {
        let attempt_duration = bigint_to_u64(attempt_duration);
        self.with_dispatcher_mut(|vm| {
            CoreVM::propose_run_completion(
                vm,
                handle.into(),
                RunExitResult::RetryableFailure {
                    attempt_duration: Duration::from_millis(attempt_duration),
                    error: Error::internal(error_message)
                        .with_stacktrace(error_stacktrace.unwrap_or_default())
                        .with_should_pause(true),
                },
                RetryPolicy::Infinite,
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_cancel_invocation")]
    pub fn sys_cancel_invocation(
        &mut self,
        env: Env,
        target_invocation_id: String,
    ) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| CoreVM::sys_cancel_invocation(vm, target_invocation_id))
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_write_output_success")]
    pub fn sys_write_output_success(&mut self, env: Env, buffer: Uint8Array) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_write_output(
                vm,
                NonEmptyValue::Success(buffer.to_vec().into()),
                Default::default(),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_write_output_failure")]
    pub fn sys_write_output_failure(&mut self, env: Env, value: WasmFailure) -> napi::Result<()> {
        self.with_dispatcher_mut(|vm| {
            CoreVM::sys_write_output(
                vm,
                NonEmptyValue::Failure(value.into()),
                Default::default(),
            )
        })
        .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "sys_end")]
    pub fn sys_end(&mut self, env: Env) -> napi::Result<()> {
        self.with_dispatcher_mut(CoreVM::sys_end)
            .map_err(|e| throw_failure(&env, e.into()))
    }

    #[napi(js_name = "is_processing")]
    pub fn is_processing(&self) -> bool {
        self.with_dispatcher(|vm| CoreVM::state(vm).is_processing())
    }

    #[napi(js_name = "last_command_index")]
    pub fn last_command_index(&self) -> i32 {
        self.with_dispatcher(|vm| CoreVM::last_command_index(vm) as i32)
    }
}

#[napi(js_name = "WasmIdentityVerifier")]
pub struct WasmIdentityVerifier {
    identity_verifier: IdentityVerifier,
}

#[napi]
impl WasmIdentityVerifier {
    #[napi(constructor)]
    pub fn new(keys: Vec<String>) -> napi::Result<WasmIdentityVerifier> {
        let k: Vec<_> = keys.iter().map(|s| s.as_str()).collect();
        Ok(WasmIdentityVerifier {
            identity_verifier: IdentityVerifier::new(&k)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?,
        })
    }

    #[napi(js_name = "verify_identity")]
    pub fn verify_identity(
        &self,
        path: String,
        headers: Vec<WasmHeaderData>,
    ) -> napi::Result<()> {
        self.identity_verifier
            .verify_identity(&WasmHeaderList(headers), &path)
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }
}

#[napi(js_name = "cancel_handle")]
pub fn cancel_handle() -> u32 {
    CANCEL_NOTIFICATION_HANDLE.into()
}
