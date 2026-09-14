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
 * TypeScript port of the Restate shared core state machine (`vm/mod.rs` and
 * `vm/transitions/*` of `restate-sdk-shared-core`).
 *
 * The VM is single-threaded and does not perform I/O. Every call is
 * synchronous. See `docs/sdk-integration.md` of the shared core for the
 * lifecycle contract.
 */

import {
  LogLevel,
  WasmCommandType,
  type WasmHeader,
  type WasmUnresolvedFuture,
} from "../types.js";
import {
  AsyncResultsState,
  fromUnresolvedFuture,
  futureDebug,
  futureHandles,
  single,
  type FutureNode,
} from "./async_results.js";
import { Context, EagerState, type StartInfo } from "./context.js";
import { Decoder, type RawMessage } from "./encoding.js";
import {
  badEagerStateKeyError,
  closedError,
  codes,
  commandMismatchError,
  commandTypeMismatchError,
  DecodingError,
  EMPTY_GET_EAGER_STATE,
  EMPTY_GET_EAGER_STATE_KEYS,
  EMPTY_IDEMPOTENCY_KEY,
  EMPTY_LIMIT_KEY,
  EMPTY_SCOPE,
  INPUT_CLOSED_WHILE_WAITING_ENTRIES,
  KNOWN_ENTRIES_IS_ZERO,
  MISSING_CONTENT_TYPE,
  outOfBoundsDuration,
  SUSPENDED,
  unavailableEntryError,
  UNEXPECTED_ENTRY_MESSAGE,
  UNEXPECTED_INPUT_MESSAGE,
  unexpectedStateError,
  uncompletedDoProgressDuringReplay,
  unsupportedFeatureForNegotiatedVersion,
  VMError,
  type CommandMetadata,
  type NotificationMetadata,
} from "./errors.js";
import {
  AttachInvocationCommand,
  AwaitingOnMessageDesc,
  CallCommand,
  CANCEL_SIGNAL_ID,
  ClearAllStateCommand,
  ClearStateCommand,
  CompleteAwakeableCommand,
  CompletePromiseCommand,
  EndMessageDesc,
  ErrorBehavior,
  ErrorMessageDesc,
  GetEagerStateCommand,
  GetEagerStateKeysCommand,
  GetInvocationOutputCommand,
  GetLazyStateCommand,
  GetLazyStateKeysCommand,
  GetPromiseCommand,
  InputCommand,
  isCommandMessageType,
  isNotificationMessageType,
  MessageType,
  OneWayCallCommand,
  OutputCommand,
  PeekPromiseCommand,
  ProposeRunCompletionAckMessageDesc,
  ProposeRunCompletionMessageDesc,
  RunCommand,
  SendSignalCommand,
  SetStateCommand,
  SleepCommand,
  StartMessageDesc,
  VOID,
  type CommandMessageDef,
  type Failure,
  type IdempotentRequestTarget,
  type WorkflowTarget,
} from "./messages.js";
import { create, utf8Encode } from "./proto.js";
import { computeRandomSeed } from "./random_seed.js";
import {
  nextRetry,
  shouldPauseOnMaxAttempts,
  type RetryPolicy,
} from "./retries.js";
import { RunState } from "./run_state.js";
import {
  AwaitingOnPolicy,
  CANCEL_NOTIFICATION_HANDLE,
  commandTypeDisplay,
  completionId,
  DEFAULT_PAYLOAD_OPTIONS,
  JournalMismatchRetryBehavior,
  messageTypeDisplay,
  NonDeterministicChecksOption,
  notificationIdKey,
  notificationResultToValue,
  signalId,
  signalName,
  terminalFailureToFailure,
  VMState,
  type AsyncResultValue,
  type AttachInvocationTarget,
  type AwaitResponse,
  type AwakeableHandle,
  type CallHandle,
  type CommandRelationship,
  type CommandType,
  type EntryRetryInfo,
  type Input,
  type NonEmptyValue,
  type NotificationHandle,
  type NotificationId,
  type NotificationResult,
  type PayloadOptions,
  type ResponseHead,
  type RunExitResult,
  type RunHandle,
  type SendHandle,
  type Target,
  type VMOptions,
} from "./types.js";
import {
  ContentTypeError,
  MAXIMUM_SUPPORTED_VERSION,
  MINIMUM_SUPPORTED_VERSION,
  parseVersion,
  Version,
  versionContentType,
} from "./version.js";

const CONTENT_TYPE = "content-type";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface CoreLogger {
  enabled(level: LogLevel): boolean;
  log(level: LogLevel, message: string): void;
}

export const NOOP_LOGGER: CoreLogger = {
  enabled: () => false,
  log: () => {},
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Simple FIFO queue with O(1) amortized shift. */
class Queue<T> {
  private items: T[] = [];
  private head = 0;

  push(item: T) {
    this.items.push(item);
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) {
      return undefined;
    }
    const item = this.items[this.head]!;
    this.head++;
    if (this.head > 32 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }

  get length(): number {
    return this.items.length - this.head;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }
}

type State =
  | { readonly kind: "WaitingStart" }
  | {
      readonly kind: "WaitingReplayEntries";
      receivedEntries: number;
      readonly commands: Queue<RawMessage>;
      readonly asyncResults: AsyncResultsState;
      readonly eagerState: EagerState;
    }
  | {
      readonly kind: "Replaying";
      readonly commands: Queue<RawMessage>;
      readonly runState: RunState;
      readonly asyncResults: AsyncResultsState;
      readonly eagerState: EagerState;
    }
  | {
      readonly kind: "Processing";
      processingFirstEntry: boolean;
      readonly runState: RunState;
      readonly asyncResults: AsyncResultsState;
      readonly eagerState: EagerState;
    }
  | { readonly kind: "Closed" };

type ExecutingState = Extract<State, { kind: "Replaying" | "Processing" }>;

const WAITING_START: State = { kind: "WaitingStart" };
const CLOSED: State = { kind: "Closed" };

function asUnexpectedState(state: State, event: string): VMError {
  if (state.kind === "Closed") {
    return closedError(event);
  }
  return unexpectedStateError(state.kind, event);
}

/** Tries to transition to Processing when the condition is met, in all the other cases returns the current state. */
function tryTransitionToProcessing(state: State): State {
  if (state.kind === "Replaying" && state.commands.isEmpty()) {
    return {
      kind: "Processing",
      processingFirstEntry: true,
      runState: state.runState,
      asyncResults: state.asyncResults,
      eagerState: state.eagerState,
    };
  }
  return state;
}

function eagerStateOf(state: State): EagerState | undefined {
  switch (state.kind) {
    case "WaitingReplayEntries":
    case "Replaying":
    case "Processing":
      return state.eagerState;
    default:
      return undefined;
  }
}

function isExecuting(state: State): state is ExecutingState {
  return state.kind === "Replaying" || state.kind === "Processing";
}

interface TrackedInvocationId {
  handle: NotificationHandle;
  invocationId: string | undefined;
}

type LastTransition = { ok: State } | { err: VMError };

type Suspended = "suspended";

/**
 * Determine whether payload equality checks should be skipped.
 * Returns true if either the global flag is set or the current call has unstable serialization.
 */
function shouldIgnorePayloadEquality(
  globalIgnore: boolean,
  options: PayloadOptions
): boolean {
  return globalIgnore || options.unstableSerialization;
}

function withRelatedCommandMetadata(
  e: unknown,
  meta: CommandMetadata
): unknown {
  if (e instanceof VMError) {
    return e.withRelatedCommandMetadata(meta);
  }
  if (e instanceof DecodingError) {
    return e.toVMError().withRelatedCommandMetadata(meta);
  }
  return e;
}

const U64_MAX = (1n << 64n) - 1n;

function checkU64(value: bigint, what: string): bigint {
  if (value < 0n || value > U64_MAX) {
    // Same as the Rust `Debug` of `TryFromIntError`
    throw outOfBoundsDuration(what, "TryFromIntError(())");
  }
  return value;
}

// URL safe base64 without padding, same as the Rust `URL_SAFE` engine with `INDIFFERENT_PAD`
const B64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlNoPad(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      B64_URL_ALPHABET[(n >> 18) & 63]! +
      B64_URL_ALPHABET[(n >> 12) & 63]! +
      B64_URL_ALPHABET[(n >> 6) & 63]! +
      B64_URL_ALPHABET[n & 63]!;
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const n = (bytes[i]! << 16) | (remaining === 2 ? bytes[i + 1]! << 8 : 0);
    out +=
      B64_URL_ALPHABET[(n >> 18) & 63]! + B64_URL_ALPHABET[(n >> 12) & 63]!;
    if (remaining === 2) {
      out += B64_URL_ALPHABET[(n >> 6) & 63]!;
    }
  }
  return out;
}

const AWAKEABLE_PREFIX = "sign_1";

export function awakeableIdStr(
  id: Uint8Array,
  completionIndex: number
): string {
  const buf = new Uint8Array(id.length + 4);
  buf.set(id, 0);
  new DataView(buf.buffer).setUint32(id.length, completionIndex >>> 0, false);
  return `${AWAKEABLE_PREFIX}${base64UrlNoPad(buf)}`;
}

/** Approximation of Rust's `Duration` Debug formatting, used only in debug logs. */
function formatDurationMillis(millis: bigint): string {
  if (millis < 0n) {
    millis = 0n;
  }
  if (millis >= 1000n) {
    const secs = millis / 1000n;
    const rem = millis % 1000n;
    if (rem === 0n) {
      return `${secs}s`;
    }
    return `${secs}.${rem.toString().padStart(3, "0").replace(/0+$/, "")}s`;
  }
  return `${millis}ms`;
}

function extractHeader(
  headers: readonly WasmHeader[],
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.key.toLowerCase() === lower) {
      return h.value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The VM
// ---------------------------------------------------------------------------

export class CoreVM {
  private readonly options: VMOptions;

  // Input decoder
  private readonly decoder = new Decoder();

  // State machine
  private readonly context: Context;
  private lastTransition: LastTransition = { ok: WAITING_START };

  // Implicit cancellation tracking
  private trackedInvocationIds: TrackedInvocationId[] = [];

  // Run names, useful for debugging
  private readonly sysRunNames = new Map<NotificationHandle, string>();

  constructor(
    requestHeaders: readonly WasmHeader[],
    options: VMOptions,
    private readonly logger: CoreLogger = NOOP_LOGGER
  ) {
    const contentType = extractHeader(requestHeaders, CONTENT_TYPE);
    if (contentType === undefined) {
      throw MISSING_CONTENT_TYPE.clone();
    }
    let version: Version;
    try {
      version = parseVersion(contentType);
    } catch (e) {
      if (e instanceof ContentTypeError) {
        throw new VMError(codes.UNSUPPORTED_MEDIA_TYPE, e.message);
      }
      throw e;
    }

    if (
      version < MINIMUM_SUPPORTED_VERSION ||
      version > MAXIMUM_SUPPORTED_VERSION
    ) {
      throw new VMError(
        codes.UNSUPPORTED_MEDIA_TYPE,
        `Unsupported protocol version ${Version[version]}, not within [${Version[MINIMUM_SUPPORTED_VERSION]} to ${Version[MAXIMUM_SUPPORTED_VERSION]}]. You might need to rediscover the service, check https://docs.restate.dev/references/errors/#RT0015`
      );
    }

    this.options = options;
    this.context = new Context(
      version,
      options.nonDeterminismChecks ===
        NonDeterministicChecksOption.PayloadChecksDisabled,
      options.awaitingOnPolicy
    );
  }

  // --- Debug helpers

  private debugInvocationId(): string {
    return this.context.startInfo?.debugId ?? "";
  }

  private log(level: LogLevel, message: string) {
    if (this.logger.enabled(level)) {
      this.logger.log(level, message);
    }
  }

  private debug(message: string) {
    this.log(LogLevel.DEBUG, message);
  }

  private trace(message: string) {
    this.log(LogLevel.TRACE, message);
  }

  /** Informative debug logs, emitted only when processing */
  private invocationDebugLogs(message: () => string) {
    if (this.isProcessing() && this.logger.enabled(LogLevel.DEBUG)) {
      this.logger.log(LogLevel.DEBUG, message());
    }
  }

  private isProcessing(): boolean {
    return (
      "ok" in this.lastTransition &&
      this.lastTransition.ok.kind === "Processing"
    );
  }

  private isImplicitCancellationEnabled(): boolean {
    return this.options.implicitCancellation.type === "enabled";
  }

  // --- Transition machinery

  /**
   * Runs a transition on the current state. Mirrors `CoreVM::do_transition`:
   * if the state machine is in error mode, the error is propagated back; on a
   * transition failure the error is recorded, the error message is written out
   * (unless the VM was already closed) and the error is thrown.
   */
  private doTransition<O>(transition: (state: State) => [State, O]): O {
    if ("err" in this.lastTransition) {
      // The state machine is in error mode, we just propagate back the error
      throw this.lastTransition.err.clone();
    }
    const s = this.lastTransition.ok;
    const wasClosed = s.kind === "Closed";
    this.lastTransition = { ok: WAITING_START };

    let result: [State, O];
    try {
      result = transition(s);
    } catch (e) {
      let err: VMError;
      if (e instanceof VMError) {
        err = e;
      } else if (e instanceof DecodingError) {
        err = e.toVMError();
      } else {
        // Not a VM error: this is a bug. Restore the state and propagate.
        this.lastTransition = { ok: s };
        throw e;
      }

      this.debug(`Failed with error ${err.toString()}`);

      // If journal mismatch, apply error policy
      if (
        err.code === codes.JOURNAL_MISMATCH &&
        this.context.negotiatedProtocolVersion >= Version.V7
      ) {
        switch (this.options.journalMismatchRetryBehavior) {
          case JournalMismatchRetryBehavior.Pause:
            err.behavior = ErrorBehavior.Pause;
            break;
          case JournalMismatchRetryBehavior.FailTerminally:
            err.behavior = ErrorBehavior.Fail;
            break;
          case JournalMismatchRetryBehavior.FollowRetryPolicy:
            err.behavior = ErrorBehavior.Retry;
            break;
        }
      }

      this.lastTransition = { err: err.clone() };

      if (!wasClosed) {
        // We write it out only if it wasn't closed before
        this.context.output.send(
          MessageType.Error,
          ErrorMessageDesc,
          err.asErrorMessage()
        );
        this.context.output.sendEof();
      }

      throw err;
    }

    this.lastTransition = { ok: result[0] };
    return result[1];
  }

  private hitError(error: VMError): never {
    this.doTransition(() => {
      throw error;
    });
    // do_transition always throws for HitError
    throw error;
  }

  private verifyFeatureSupport(
    feature: string,
    minimumRequiredProtocol: Version
  ) {
    if (this.context.negotiatedProtocolVersion < minimumRequiredProtocol) {
      this.hitError(
        unsupportedFeatureForNegotiatedVersion(
          feature,
          this.context.negotiatedProtocolVersion,
          minimumRequiredProtocol
        )
      );
    }
  }

  private verifyErrorMetadataFeatureSupport(value: NonEmptyValue) {
    if (value.type === "failure" && value.failure.metadata.length > 0) {
      this.verifyFeatureSupport("terminal error metadata", Version.V6);
    }
  }

  // --- Input transitions (vm/transitions/input.rs)

  private newMessage(state: State, msg: RawMessage): State {
    const ty = msg.ty;
    if (ty === MessageType.Start) {
      return this.newStartMessage(
        state,
        msg.decodeTo({ ty: MessageType.Start, desc: StartMessageDesc }, 0)
      );
    }
    if (isCommandMessageType(ty)) {
      return this.newCommandMessage(state, msg);
    }
    if (isNotificationMessageType(ty)) {
      return this.newNotificationMessage(state, msg);
    }
    if (ty === MessageType.ProposeRunCompletionAck) {
      return this.newProposeRunCompletionAckMessage(state, msg);
    }
    throw UNEXPECTED_INPUT_MESSAGE.clone();
  }

  private newStartMessage(
    _state: State,
    msg: ReturnType<typeof create<import("./messages.js").StartMessage>>
  ): State {
    const version = this.context.negotiatedProtocolVersion;
    const isV7 = version >= Version.V7;
    const startInfo: StartInfo = {
      id: msg.id,
      debugId: msg.debug_id,
      key: msg.key,
      entriesToReplay: msg.known_entries,
      retryCountSinceLastStoredEntry: msg.retry_count_since_last_stored_entry,
      durationSinceLastStoredEntry: msg.duration_since_last_stored_entry,
      randomSeed: version >= Version.V6 ? msg.random_seed : undefined,
      scope: isV7 ? msg.scope : undefined,
      limitKey: isV7 ? msg.limit_key : undefined,
      idempotencyKey: isV7 ? msg.idempotency_key : undefined,
    };
    this.context.startInfo = startInfo;

    const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
    const values: [string, Uint8Array][] = [];
    for (const e of msg.state_map) {
      let key: string;
      try {
        key = strictUtf8.decode(e.key);
      } catch (err) {
        throw badEagerStateKeyError(
          err instanceof Error ? err.message : String(err)
        );
      }
      values.push([key, e.value]);
    }
    const eagerState = new EagerState(msg.partial_state, values);

    this.debug("Start invocation");

    if (msg.known_entries === 0) {
      throw KNOWN_ENTRIES_IS_ZERO.clone();
    }

    return {
      kind: "WaitingReplayEntries",
      receivedEntries: 0,
      commands: new Queue(),
      asyncResults: new AsyncResultsState(),
      eagerState,
    };
  }

  private newNotificationMessage(state: State, msg: RawMessage): State {
    switch (state.kind) {
      case "WaitingReplayEntries":
      case "Replaying":
      case "Processing":
        state.asyncResults.enqueue(msg.decodeAsNotification());
        break;
      case "Closed":
        // Can ignore
        break;
      default:
        throw asUnexpectedState(state, "NewNotificationMessage");
    }
    return this.postReceiveEntry(state);
  }

  private newProposeRunCompletionAckMessage(
    state: State,
    msg: RawMessage
  ): State {
    switch (state.kind) {
      case "Processing": {
        const ack = msg.decodeTo(
          {
            ty: MessageType.ProposeRunCompletionAck,
            desc: ProposeRunCompletionAckMessageDesc,
          },
          0
        );
        state.asyncResults.enqueueRunCompletionAck(ack.completion_id);
        break;
      }
      case "Closed":
        // Can ignore
        break;
      default:
        throw asUnexpectedState(state, "NewProposeRunCompletionAckMessage");
    }
    return state;
  }

  private newCommandMessage(state: State, msg: RawMessage): State {
    if (state.kind === "WaitingReplayEntries") {
      state.commands.push(msg);
    } else {
      throw UNEXPECTED_ENTRY_MESSAGE.clone();
    }
    return this.postReceiveEntry(state);
  }

  private postReceiveEntry(state: State): State {
    if (state.kind === "WaitingReplayEntries") {
      state.receivedEntries += 1;
      if (
        this.context.expectStartInfo().entriesToReplay === state.receivedEntries
      ) {
        return {
          kind: "Replaying",
          commands: state.commands,
          runState: new RunState(),
          asyncResults: state.asyncResults,
          eagerState: state.eagerState,
        };
      }
    }
    return state;
  }

  private notifyInputClosedTransition(state: State): State {
    if (
      state.kind === "WaitingStart" ||
      state.kind === "WaitingReplayEntries"
    ) {
      throw INPUT_CLOSED_WHILE_WAITING_ENTRIES.clone();
    }
    return state;
  }

  // --- Terminal transitions (vm/transitions/terminal.rs)

  private hitSuspensionPoint(state: State, awaitingOn: FutureNode): State {
    if (state.kind === "Closed") {
      // Nothing to do
      return state;
    }
    if (state.kind !== "Processing") {
      throw asUnexpectedState(state, "HitSuspensionPoint");
    }
    this.debug("Suspending");

    const future = state.asyncResults.resolveUnresolvedFuture(awaitingOn);
    this.context.output.sendSuspension({ awaiting_on: future });
    this.context.output.sendEof();

    return CLOSED;
  }

  private sysEndTransition(state: State): State {
    switch (state.kind) {
      case "Processing":
        this.context.output.send(MessageType.End, EndMessageDesc, {});
        this.context.output.sendEof();
        return CLOSED;
      case "Closed":
        // Tolerate the case where the state machine is already ended/suspended
        return state;
      default:
        throw asUnexpectedState(state, "end invocation");
    }
  }

  // --- Async results transitions (vm/transitions/async_results.rs)

  private doProgressTransition(
    state: State,
    unresolvedFuture: FutureNode
  ): [State, AwaitResponse | Suspended] {
    switch (state.kind) {
      case "Replaying": {
        const res = state.asyncResults.tryResolveFuture(unresolvedFuture);
        if (res.type === "anyCompleted") {
          // We're good, let's give back control to user code
          return [state, { type: "anyCompleted" }];
        }
        // This assertion proves the user mutated the code, adding an await point.
        // See the Rust implementation for the proof by contradiction.

        // Prepare error metadata here, we gotta be nice to make sure users can debug this
        const awaitingOnHandles = futureHandles(res.future);
        const notificationIds =
          state.asyncResults.resolveNotificationHandles(awaitingOnHandles);
        const knownNotificationMetadata = new Map<
          string,
          NotificationMetadata
        >();
        let knownCommandMetadata: CommandMetadata | undefined = undefined;
        // Collect run info
        for (const handle of awaitingOnHandles) {
          const runInfo = state.runState.getRunInfo(handle);
          if (runInfo !== undefined) {
            const notificationId =
              state.asyncResults.mustResolveNotificationHandle(handle);
            const commandMetadata: CommandMetadata = {
              name: runInfo.commandName,
              index: runInfo.commandIndex,
              ty: MessageType.RunCommand,
            };
            knownCommandMetadata = commandMetadata;
            knownNotificationMetadata.set(notificationIdKey(notificationId), {
              type: "relatedToCommand",
              command: commandMetadata,
            });
          }
        }
        // For awakeables, prep ids
        for (const notificationId of notificationIds) {
          if (notificationId.type === "signal") {
            if (notificationId.id === CANCEL_SIGNAL_ID) {
              knownNotificationMetadata.set(notificationIdKey(notificationId), {
                type: "cancellation",
              });
            } else if (notificationId.id > 16) {
              knownNotificationMetadata.set(notificationIdKey(notificationId), {
                type: "awakeable",
                id: awakeableIdStr(
                  this.context.expectStartInfo().id,
                  notificationId.id
                ),
              });
            }
          }
        }
        const error = uncompletedDoProgressDuringReplay(
          notificationIds,
          knownNotificationMetadata
        );
        if (knownCommandMetadata !== undefined) {
          error.withRelatedCommandMetadata(knownCommandMetadata);
        }
        throw error;
      }
      case "Processing": {
        const res = state.asyncResults.tryResolveFuture(unresolvedFuture);
        if (res.type === "anyCompleted") {
          // We're good, let's give back control to user code
          return [state, { type: "anyCompleted" }];
        }

        const awaitingOnHandles = futureHandles(res.future);

        // We couldn't find any notification for the given ids, let's check if there's some run to execute
        const runToExecute = state.runState.tryExecuteRun(awaitingOnHandles);
        if (runToExecute !== undefined) {
          return [state, { type: "executeRun", handle: runToExecute }];
        }

        // Maybe any of the handles in the awaiting on set is executing?
        const waitingRunProposal =
          state.runState.anyExecutingInThisSet(awaitingOnHandles);

        // Check suspension condition
        if (this.context.inputIsClosed) {
          // Some run still executing; it's not time to suspend yet!
          if (waitingRunProposal) {
            return [
              state,
              {
                type: "waitingExternalProgress",
                waitingInput: false,
                waitingRunProposal: true,
              },
            ];
          }

          const newState = this.hitSuspensionPoint(state, res.future);
          return [newState, "suspended"];
        }

        // The only thing we can do at this point is to wait for some notification from the runtime,
        // which will be received reading from input.

        // Before returning, let's see if we need to send AwaitingOnMessage
        let sendAwaitingOn: boolean;
        switch (this.context.awaitingOnPolicy) {
          case AwaitingOnPolicy.SendAlways:
            sendAwaitingOn = true;
            break;
          case AwaitingOnPolicy.DontSendWhenExecutingRun:
            sendAwaitingOn = !state.runState.anyExecuting();
            break;
          case AwaitingOnPolicy.DontSend:
            sendAwaitingOn = false;
            break;
        }
        if (
          this.context.negotiatedProtocolVersion >= Version.V7 &&
          sendAwaitingOn
        ) {
          this.context.output.send(
            MessageType.AwaitingOn,
            AwaitingOnMessageDesc,
            {
              awaiting_on: state.asyncResults.resolveUnresolvedFuture(
                res.future
              ),
              executing_side_effects: false,
            }
          );
        }

        // Nothing else can be done, we need more input
        return [
          state,
          {
            type: "waitingExternalProgress",
            waitingInput: true,
            waitingRunProposal,
          },
        ];
      }
      default:
        throw asUnexpectedState(state, "await");
    }
  }

  private takeNotificationTransition(
    state: State,
    handle: NotificationHandle
  ): [State, NotificationResult | undefined] {
    if (isExecuting(state)) {
      return [state, state.asyncResults.takeHandle(handle)];
    }
    throw asUnexpectedState(state, "TakeNotification");
  }

  private copyNotificationTransition(
    state: State,
    handle: NotificationHandle
  ): [State, NotificationResult | undefined] {
    if (isExecuting(state)) {
      return [state, state.asyncResults.copyHandle(handle)];
    }
    throw asUnexpectedState(state, "CopyNotification");
  }

  // --- Journal transitions (vm/transitions/journal.rs)

  private sysInputTransition(state: State): [State, Input] {
    const expected = create(InputCommand.desc);
    this.context.journal.transition(InputCommand, expected);
    let s: State;
    let msg: import("./messages.js").InputCommandMessage;
    try {
      [s, msg] = this.popJournalEntry(
        state,
        InputCommand,
        expected,
        DEFAULT_PAYLOAD_OPTIONS
      );
    } catch (e) {
      throw withRelatedCommandMetadata(
        e,
        this.context.journal.resolveRelatedCommand({ type: "last" })
      );
    }
    const startInfo = this.context.expectStartInfo();

    return [
      s,
      {
        invocationId: startInfo.debugId,
        randomSeed: startInfo.randomSeed ?? computeRandomSeed(startInfo.id),
        key: startInfo.key,
        headers: msg.headers.map((h) => ({ key: h.key, value: h.value })),
        input: msg.value?.content ?? new Uint8Array(0),
        scope: startInfo.scope,
        limitKey: startInfo.limitKey,
        idempotencyKey: startInfo.idempotencyKey,
      },
    ];
  }

  private sysNonCompletableEntry<M extends object>(
    state: State,
    def: CommandMessageDef<M>,
    expected: M,
    options: PayloadOptions
  ): State {
    this.context.journal.transition(def, expected);
    try {
      const [s] = this.popOrWriteJournalEntry(state, def, expected, options);
      return s;
    } catch (e) {
      throw withRelatedCommandMetadata(
        e,
        this.context.journal.lastCommandMetadata()
      );
    }
  }

  private sysSimpleCompletableEntry<M extends object>(
    state: State,
    def: CommandMessageDef<M>,
    expected: M,
    completionIdValue: number,
    options: PayloadOptions
  ): [State, NotificationHandle] {
    const [s, handles] = this.sysCompletableEntryWithMultipleCompletions(
      state,
      def,
      expected,
      [completionIdValue],
      options
    );
    return [s, handles[0]!];
  }

  private sysCompletableEntryWithMultipleCompletions<M extends object>(
    state: State,
    def: CommandMessageDef<M>,
    expected: M,
    completionIds: number[],
    options: PayloadOptions
  ): [State, NotificationHandle[]] {
    this.context.journal.transition(def, expected);
    let s: State;
    try {
      [s] = this.popOrWriteJournalEntry(state, def, expected, options);
    } catch (e) {
      throw withRelatedCommandMetadata(
        e,
        this.context.journal.lastCommandMetadata()
      );
    }

    if (isExecuting(s)) {
      // Create mapping for all the necessary notification ids
      const notificationHandles = completionIds.map((cid) =>
        s.asyncResults.createHandleMapping(completionId(cid))
      );
      return [s, notificationHandles];
    }
    throw asUnexpectedState(
      s,
      messageTypeDisplay(def.ty)
    ).withRelatedCommandMetadata(this.context.journal.lastCommandMetadata());
  }

  private createSignalHandleTransition(
    state: State,
    sysName: string,
    notificationId: NotificationId
  ): [State, NotificationHandle] {
    if (isExecuting(state)) {
      // Create mapping for the notification id
      return [state, state.asyncResults.createHandleMapping(notificationId)];
    }
    throw asUnexpectedState(state, sysName);
  }

  private sysStateGetTransition(
    state: State,
    key: string,
    options: PayloadOptions
  ): [State, NotificationHandle] {
    const cid = this.context.journal.nextCompletionNotificationId();

    switch (state.kind) {
      case "Processing": {
        state.processingFirstEntry = false;

        // Let's look into the eager_state
        const eager = state.eagerState.get(key);
        if (eager.type !== "unknown") {
          // Eager state case, we're good let's prepare the ready notification and send the get eager state entry
          const newEntry = create(GetEagerStateCommand.desc, {
            key: utf8Encode(key),
            void: eager.type === "empty" ? VOID : undefined,
            value:
              eager.type === "value" ? { content: eager.value } : undefined,
          });
          const newNotification = {
            id: completionId(cid),
            result:
              eager.type === "empty"
                ? ({ type: "void", void: VOID } as NotificationResult)
                : ({
                    type: "value",
                    value: { content: eager.value },
                  } as NotificationResult),
          };
          const handle = state.asyncResults.createHandleMapping(
            newNotification.id
          );

          state.asyncResults.insertReady(newNotification);
          this.context.journal.transition(GetEagerStateCommand, newEntry);
          this.context.output.sendCommand(GetEagerStateCommand, newEntry);

          return [state, handle];
        } else {
          const newEntry = create(GetLazyStateCommand.desc, {
            key: utf8Encode(key),
            result_completion_id: cid,
          });
          const handle = state.asyncResults.createHandleMapping(
            completionId(cid)
          );

          this.context.journal.transition(GetLazyStateCommand, newEntry);
          this.context.output.sendCommand(GetLazyStateCommand, newEntry);

          return [state, handle];
        }
      }
      case "Replaying": {
        this.context.journal.transition(
          GetEagerStateCommand,
          create(GetEagerStateCommand.desc)
        );

        let handle: NotificationHandle;
        try {
          handle = this.processGetEntryDuringReplay(
            key,
            cid,
            state.commands,
            state.asyncResults,
            options
          );
        } catch (e) {
          throw withRelatedCommandMetadata(
            e,
            this.context.journal.lastCommandMetadata()
          );
        }

        return [tryTransitionToProcessing(state), handle];
      }
      default:
        throw asUnexpectedState(
          state,
          commandTypeDisplay(WasmCommandType.GetState)
        ).withRelatedCommandMetadata(
          this.context.journal.resolveRelatedCommand({
            type: "next",
            ty: WasmCommandType.GetState,
          })
        );
    }
  }

  private processGetEntryDuringReplay(
    key: string,
    cid: number,
    commands: Queue<RawMessage>,
    asyncResults: AsyncResultsState,
    options: PayloadOptions
  ): NotificationHandle {
    const handle = asyncResults.createHandleMapping(completionId(cid));
    const ignorePayloadEquality = shouldIgnorePayloadEquality(
      this.context.nonDeterministicChecksIgnorePayloadEquality,
      options
    );

    const actual = commands.shift();
    if (actual === undefined) {
      throw unavailableEntryError(GetLazyStateCommand.ty);
    }

    switch (actual.ty) {
      case MessageType.GetEagerStateCommand: {
        this.context.journal.currentEntryTy = MessageType.GetEagerStateCommand;
        const cmd = actual.decodeTo(
          GetEagerStateCommand,
          this.context.journal.commandIndex()
        );
        checkEntryHeaderMatch(
          this.context.journal.commandIndex(),
          GetEagerStateCommand,
          cmd,
          create(GetEagerStateCommand.desc, {
            key: utf8Encode(key),
            void: cmd.void,
            value: cmd.value,
            name: "",
          }),
          ignorePayloadEquality
        );

        let notificationResult: NotificationResult;
        if (cmd.void !== undefined) {
          notificationResult = { type: "void", void: cmd.void };
        } else if (cmd.value !== undefined) {
          notificationResult = { type: "value", value: cmd.value };
        } else {
          throw EMPTY_GET_EAGER_STATE.clone();
        }

        asyncResults.insertReady({
          id: completionId(cid),
          result: notificationResult,
        });
        break;
      }
      case MessageType.GetLazyStateCommand: {
        this.context.journal.currentEntryTy = MessageType.GetLazyStateCommand;
        const cmd = actual.decodeTo(
          GetLazyStateCommand,
          this.context.journal.commandIndex()
        );
        checkEntryHeaderMatch(
          this.context.journal.commandIndex(),
          GetLazyStateCommand,
          cmd,
          create(GetLazyStateCommand.desc, {
            key: utf8Encode(key),
            result_completion_id: cid,
            name: "",
          }),
          ignorePayloadEquality
        );
        break;
      }
      default:
        throw commandTypeMismatchError(
          this.context.journal.commandIndex(),
          actual.ty,
          MessageType.GetLazyStateCommand
        );
    }

    return handle;
  }

  private sysStateGetKeysTransition(state: State): [State, NotificationHandle] {
    const cid = this.context.journal.nextCompletionNotificationId();

    switch (state.kind) {
      case "Processing": {
        state.processingFirstEntry = false;

        // Let's look into the eager_state
        const eager = state.eagerState.getKeys();
        if (eager.type === "keys") {
          // Eager state case, we're good let's prepare the ready notification and send the get eager state entry
          const stateKeys = { keys: eager.keys.map((k) => utf8Encode(k)) };
          const newEntry = create(GetEagerStateKeysCommand.desc, {
            value: stateKeys,
          });
          const newNotification = {
            id: completionId(cid),
            result: {
              type: "stateKeys",
              stateKeys: { keys: eager.keys.map((k) => utf8Encode(k)) },
            } as NotificationResult,
          };
          const handle = state.asyncResults.createHandleMapping(
            newNotification.id
          );

          state.asyncResults.insertReady(newNotification);
          this.context.journal.transition(GetEagerStateKeysCommand, newEntry);
          this.context.output.sendCommand(GetEagerStateKeysCommand, newEntry);

          return [state, handle];
        } else {
          const newEntry = create(GetLazyStateKeysCommand.desc, {
            result_completion_id: cid,
          });
          const handle = state.asyncResults.createHandleMapping(
            completionId(cid)
          );

          this.context.journal.transition(GetLazyStateKeysCommand, newEntry);
          this.context.output.sendCommand(GetLazyStateKeysCommand, newEntry);

          return [state, handle];
        }
      }
      case "Replaying": {
        this.context.journal.transition(
          GetEagerStateKeysCommand,
          create(GetEagerStateKeysCommand.desc)
        );

        let handle: NotificationHandle;
        try {
          handle = this.processGetEntryKeysDuringReplay(
            cid,
            state.commands,
            state.asyncResults
          );
        } catch (e) {
          throw withRelatedCommandMetadata(
            e,
            this.context.journal.lastCommandMetadata()
          );
        }

        return [tryTransitionToProcessing(state), handle];
      }
      default:
        throw asUnexpectedState(
          state,
          commandTypeDisplay(WasmCommandType.GetStateKeys)
        ).withRelatedCommandMetadata(
          this.context.journal.resolveRelatedCommand({
            type: "next",
            ty: WasmCommandType.GetStateKeys,
          })
        );
    }
  }

  private processGetEntryKeysDuringReplay(
    cid: number,
    commands: Queue<RawMessage>,
    asyncResults: AsyncResultsState
  ): NotificationHandle {
    const handle = asyncResults.createHandleMapping(completionId(cid));
    // State keys don't contain payload bytes, so we only use the global flag
    const ignorePayloadEquality =
      this.context.nonDeterministicChecksIgnorePayloadEquality;

    const actual = commands.shift();
    if (actual === undefined) {
      throw unavailableEntryError(GetLazyStateKeysCommand.ty);
    }

    switch (actual.ty) {
      case MessageType.GetEagerStateKeysCommand: {
        this.context.journal.currentEntryTy =
          MessageType.GetEagerStateKeysCommand;
        const cmd = actual.decodeTo(
          GetEagerStateKeysCommand,
          this.context.journal.commandIndex()
        );
        checkEntryHeaderMatch(
          this.context.journal.commandIndex(),
          GetEagerStateKeysCommand,
          cmd,
          create(GetEagerStateKeysCommand.desc, {
            value: cmd.value,
            name: "",
          }),
          ignorePayloadEquality
        );

        if (cmd.value === undefined) {
          throw EMPTY_GET_EAGER_STATE_KEYS.clone();
        }
        asyncResults.insertReady({
          id: completionId(cid),
          result: { type: "stateKeys", stateKeys: cmd.value },
        });
        break;
      }
      case MessageType.GetLazyStateKeysCommand: {
        this.context.journal.currentEntryTy =
          MessageType.GetLazyStateKeysCommand;
        const cmd = actual.decodeTo(
          GetLazyStateKeysCommand,
          this.context.journal.commandIndex()
        );
        checkEntryHeaderMatch(
          this.context.journal.commandIndex(),
          GetLazyStateKeysCommand,
          cmd,
          create(GetLazyStateKeysCommand.desc, {
            result_completion_id: cid,
            name: "",
          }),
          ignorePayloadEquality
        );
        break;
      }
      default:
        throw commandTypeMismatchError(
          this.context.journal.commandIndex(),
          actual.ty,
          MessageType.GetLazyStateKeysCommand
        );
    }

    return handle;
  }

  private sysStateSetTransition(
    state: State,
    key: string,
    value: Uint8Array,
    options: PayloadOptions
  ): State {
    eagerStateOf(state)?.set(key, value);
    return this.sysNonCompletableEntry(
      state,
      SetStateCommand,
      create(SetStateCommand.desc, {
        key: utf8Encode(key),
        value: { content: value },
      }),
      options
    );
  }

  private sysStateClearTransition(state: State, key: string): State {
    eagerStateOf(state)?.clear(key);
    return this.sysNonCompletableEntry(
      state,
      ClearStateCommand,
      create(ClearStateCommand.desc, { key: utf8Encode(key) }),
      DEFAULT_PAYLOAD_OPTIONS
    );
  }

  private sysStateClearAllTransition(state: State): State {
    eagerStateOf(state)?.clearAll();
    return this.sysNonCompletableEntry(
      state,
      ClearAllStateCommand,
      create(ClearAllStateCommand.desc),
      DEFAULT_PAYLOAD_OPTIONS
    );
  }

  private sysRunTransition(state: State, name: string): [State, RunHandle] {
    const resultCompletionId =
      this.context.journal.nextCompletionNotificationId();
    const expected = create(RunCommand.desc, {
      name,
      result_completion_id: resultCompletionId,
    });

    let s: State;
    let handle: NotificationHandle;
    try {
      [s, handle] = this.sysSimpleCompletableEntry(
        state,
        RunCommand,
        expected,
        resultCompletionId,
        DEFAULT_PAYLOAD_OPTIONS
      );
    } catch (e) {
      throw withRelatedCommandMetadata(
        e,
        this.context.journal.lastCommandMetadata()
      );
    }

    const notificationId = completionId(resultCompletionId);
    let needsExecution = true;
    if (isExecuting(s)) {
      // See the Rust implementation for why doing this check both in replaying and processing is safe.
      if (s.asyncResults.nonDeterministicFindId(notificationId)) {
        this.trace(
          `Found notification for ${handle} with id ${notificationIdKey(notificationId)} while replaying, the run closure won't be executed.`
        );
        needsExecution = false;
      }
    }
    if (needsExecution) {
      this.trace(
        `Run notification for ${handle} with id ${notificationIdKey(notificationId)} not found while replaying, so we enqueue the run to be executed later`
      );
      if (isExecuting(s)) {
        s.runState.insertRunToExecute(
          handle,
          this.context.journal.commandIndex(),
          name
        );
      }
    }

    return [s, { replayed: !needsExecution, handle }];
  }

  private proposeRunCompletionTransition(
    state: State,
    notificationHandle: NotificationHandle,
    runExitResult: RunExitResult,
    retryPolicy: RetryPolicy
  ): State {
    if (state.kind !== "Processing") {
      this.trace(
        `Going to ignore proposed completion for run with handle ${notificationHandle}, because state is ${state.kind}`
      );
      return state;
    }

    const notificationId =
      state.asyncResults.mustResolveNotificationHandle(notificationHandle);
    const { commandName: runName, commandIndex: runCommandIndex } =
      state.runState.notifyExecutionCompleted(notificationHandle);

    let value: { value: Uint8Array } | { failure: Failure };
    switch (runExitResult.type) {
      case "success":
        value = { value: runExitResult.value };
        break;
      case "terminalFailure":
        value = { failure: terminalFailureToFailure(runExitResult.failure) };
        break;
      case "retryableFailure": {
        const error = runExitResult.error;
        const retryInfo: EntryRetryInfo = state.processingFirstEntry
          ? this.context.inferEntryRetryInfo()
          : { retryCount: 0, retryLoopDuration: 0 };
        retryInfo.retryCount = Math.min(retryInfo.retryCount + 1, 0xffffffff);
        retryInfo.retryLoopDuration += runExitResult.attemptDuration;

        const next = nextRetry(retryPolicy, retryInfo);
        switch (next.type) {
          case "retry":
            error.nextRetryDelay = next.interval;
            error.relatedCommand = {
              name: runName,
              index: runCommandIndex,
              ty: MessageType.RunCommand,
            };
            // We need to retry!
            throw error;
          case "pause":
            error.behavior = ErrorBehavior.Pause;
            error.relatedCommand = {
              name: runName,
              index: runCommandIndex,
              ty: MessageType.RunCommand,
            };
            // Returning error here with should_pause.
            throw error;
          case "failAsTerminal":
            // We don't retry, but convert the retryable error to actual error
            value = {
              failure: {
                code: error.code,
                message: error.message,
                metadata: [],
              },
            };
            break;
        }
        break;
      }
    }

    if (notificationId.type !== "completion") {
      throw new Error(
        `NotificationId for run should be a completion id, but was ${notificationIdKey(notificationId)}`
      );
    }
    const resultCompletionId = notificationId.id;

    if (this.context.negotiatedProtocolVersion >= Version.V7) {
      state.asyncResults.cacheRunCompletion(
        resultCompletionId,
        "value" in value
          ? { type: "value", value: { content: value.value } }
          : { type: "failure", failure: value.failure }
      );
    }

    this.context.output.sendProposeRunCompletion(
      create(ProposeRunCompletionMessageDesc, {
        result_completion_id: resultCompletionId,
        value: "value" in value ? value.value : undefined,
        failure: "failure" in value ? value.failure : undefined,
      })
    );

    return state;
  }

  // --- Few reusable transitions

  private popJournalEntry<M extends object>(
    state: State,
    def: CommandMessageDef<M>,
    expected: M,
    options: PayloadOptions
  ): [State, M] {
    if (state.kind === "Replaying") {
      const raw = state.commands.shift();
      if (raw === undefined) {
        throw unavailableEntryError(def.ty);
      }
      const actual = raw.decodeTo(def, this.context.journal.commandIndex());
      const newState = tryTransitionToProcessing(state);

      const ignorePayloadEquality = shouldIgnorePayloadEquality(
        this.context.nonDeterministicChecksIgnorePayloadEquality,
        options
      );
      checkEntryHeaderMatch(
        this.context.journal.commandIndex(),
        def,
        actual,
        expected,
        ignorePayloadEquality
      );

      return [newState, actual];
    }
    throw asUnexpectedState(state, messageTypeDisplay(def.ty));
  }

  private popOrWriteJournalEntry<M extends object>(
    state: State,
    def: CommandMessageDef<M>,
    expected: M,
    options: PayloadOptions
  ): [State, M] {
    if (state.kind === "Processing") {
      state.processingFirstEntry = false;
      this.context.output.sendCommand(def, expected);
      return [state, expected];
    }
    return this.popJournalEntry(state, def, expected, options);
  }

  // -------------------------------------------------------------------------
  // Public API (the `VM` trait)
  // -------------------------------------------------------------------------

  getResponseHead(): ResponseHead {
    return {
      statusCode: 200,
      headers: [
        {
          key: CONTENT_TYPE,
          value: versionContentType(this.context.negotiatedProtocolVersion),
        },
      ],
    };
  }

  get negotiatedProtocolVersion(): Version {
    return this.context.negotiatedProtocolVersion;
  }

  // --- Input stream

  notifyInput(buffer: Uint8Array) {
    this.decoder.push(buffer);
    for (;;) {
      let msg: RawMessage | undefined;
      try {
        msg = this.decoder.consumeNext();
      } catch (e) {
        if (e instanceof DecodingError) {
          try {
            this.hitError(e.toVMError());
          } catch {
            // The transition always fails, the error is recorded in the state machine
          }
          return;
        }
        throw e;
      }
      if (msg === undefined) {
        return;
      }
      try {
        const m = msg;
        this.doTransition((s) => [this.newMessage(s, m), undefined]);
      } catch (e) {
        if (e instanceof VMError) {
          return;
        }
        throw e;
      }
    }
  }

  notifyInputClosed() {
    this.context.inputIsClosed = true;
    try {
      this.doTransition((s) => [
        this.notifyInputClosedTransition(s),
        undefined,
      ]);
    } catch (e) {
      if (!(e instanceof VMError)) {
        throw e;
      }
    }
  }

  // --- Errors

  notifyError(error: VMError, relatedCommand?: CommandRelationship) {
    if (error.behavior !== ErrorBehavior.Retry) {
      try {
        this.verifyFeatureSupport("error behavior", Version.V7);
      } catch (e) {
        if (e instanceof VMError) {
          return;
        }
        throw e;
      }
    }

    if (relatedCommand !== undefined) {
      error = error.withRelatedCommandMetadata(
        this.context.journal.resolveRelatedCommand(relatedCommand)
      );
    }

    try {
      this.hitError(error);
    } catch (e) {
      if (!(e instanceof VMError)) {
        throw e;
      }
    }
  }

  // --- Output stream

  /** Returns all the bytes currently buffered in the output buffer. */
  takeOutput(): Uint8Array {
    return this.context.output.take();
  }

  // --- Execution start waiting point

  isReadyToExecute(): boolean {
    if ("err" in this.lastTransition) {
      throw this.lastTransition.err.clone();
    }
    const s = this.lastTransition.ok;
    switch (s.kind) {
      case "WaitingStart":
      case "WaitingReplayEntries":
        return false;
      case "Processing":
      case "Replaying":
        return true;
      case "Closed":
        throw asUnexpectedState(s, "IsReadyToExecute");
    }
  }

  // --- Async results

  isCompleted(handle: NotificationHandle): boolean {
    if ("ok" in this.lastTransition && isExecuting(this.lastTransition.ok)) {
      return this.lastTransition.ok.asyncResults.isHandleCompleted(handle);
    }
    return false;
  }

  private doProgressInner(unresolvedFuture: FutureNode): AwaitResponse {
    const res = this.doTransition((s) =>
      this.doProgressTransition(s, unresolvedFuture)
    );
    if (res === "suspended") {
      throw SUSPENDED.clone();
    }
    return res;
  }

  doAwait(unresolvedFuture: WasmUnresolvedFuture): AwaitResponse {
    const future = fromUnresolvedFuture(unresolvedFuture);
    if (!this.isImplicitCancellationEnabled()) {
      return this.doProgressInner(future);
    }

    // We want the runtime to wake us up in case cancel notification comes in.
    const unresolvedFutureWithCancellation: FutureNode = {
      kind: "firstCompleted",
      children: [future, single(CANCEL_NOTIFICATION_HANDLE)],
    };

    const res = this.doProgressInner(unresolvedFutureWithCancellation);
    if (res.type !== "anyCompleted") {
      return res;
    }

    // If it's cancel signal, then let's go on with the cancellation logic
    if (!this.isCompleted(CANCEL_NOTIFICATION_HANDLE)) {
      return { type: "anyCompleted" };
    }

    // Loop once over the tracked invocation ids to resolve the unresolved ones
    for (const tracked of this.trackedInvocationIds) {
      if (tracked.invocationId !== undefined) {
        continue;
      }

      // Try to resolve it
      const r = this.doProgressInner(single(tracked.handle));
      if (r.type !== "anyCompleted") {
        return r;
      }
      const copied = this.doTransition((s) =>
        this.copyNotificationTransition(s, tracked.handle)
      );
      if (copied === undefined || copied.type !== "invocationId") {
        throw new Error(
          "Unexpected variant! If the id handle is completed, it must be an invocation id handle!"
        );
      }
      // This handle is resolved
      tracked.invocationId = copied.invocationId;
    }

    // Now we got all the invocation IDs, let's cancel!
    const toCancel = this.trackedInvocationIds;
    this.trackedInvocationIds = [];
    for (const tracked of toCancel) {
      if (tracked.invocationId === undefined) {
        throw new Error("We resolved before all the invocation ids");
      }
      this.sysCancelInvocation(tracked.invocationId);
    }

    // Flip the cancellation
    try {
      this.takeNotification(CANCEL_NOTIFICATION_HANDLE);
    } catch (e) {
      if (!(e instanceof VMError)) {
        throw e;
      }
    }

    // Done
    return { type: "cancelSignalReceived" };
  }

  takeNotification(handle: NotificationHandle): AsyncResultValue | undefined {
    const res = this.doTransition((s) =>
      this.takeNotificationTransition(s, handle)
    );
    if (res === undefined) {
      return undefined;
    }
    if (this.isImplicitCancellationEnabled()) {
      // Let's check if that's one of the tracked invocation ids
      const found = this.trackedInvocationIds.find((t) => t.handle === handle);
      if (found !== undefined) {
        if (res.type !== "invocationId") {
          throw new Error(
            `Expecting an invocation id here, but got ${res.type}`
          );
        }
        // Keep track of this invocation id
        found.invocationId = res.invocationId;
      }
    }
    return notificationResultToValue(res);
  }

  // --- Syscall(s)

  sysInput(): Input {
    return this.doTransition((s) => this.sysInputTransition(s));
  }

  sysStateGet(
    key: string,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ): NotificationHandle {
    this.invocationDebugLogs(() => `Executing 'Get state ${key}'`);
    return this.doTransition((s) =>
      this.sysStateGetTransition(s, key, options)
    );
  }

  sysStateGetKeys(): NotificationHandle {
    this.invocationDebugLogs(() => "Executing 'Get state keys'");
    return this.doTransition((s) => this.sysStateGetKeysTransition(s));
  }

  sysStateSet(
    key: string,
    value: Uint8Array,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ) {
    this.invocationDebugLogs(() => `Executing 'Set state ${key}'`);
    this.doTransition((s) => [
      this.sysStateSetTransition(s, key, value, options),
      undefined,
    ]);
  }

  sysStateClear(key: string) {
    this.invocationDebugLogs(() => `Executing 'Clear state ${key}'`);
    this.doTransition((s) => [this.sysStateClearTransition(s, key), undefined]);
  }

  sysStateClearAll() {
    this.invocationDebugLogs(() => "Executing 'Clear all state'");
    this.doTransition((s) => [this.sysStateClearAllTransition(s), undefined]);
  }

  /**
   * @param wakeUpTimeSinceUnixEpoch wake up time in millis since unix epoch
   * @param nowSinceUnixEpoch only used for debugging purposes
   */
  sysSleep(
    name: string,
    wakeUpTimeSinceUnixEpoch: bigint,
    nowSinceUnixEpoch?: bigint
  ): NotificationHandle {
    if (this.isProcessing()) {
      if (nowSinceUnixEpoch !== undefined) {
        const duration = formatDurationMillis(
          wakeUpTimeSinceUnixEpoch - nowSinceUnixEpoch
        );
        this.debug(
          name === ""
            ? `Executing 'Timer with duration ${duration}'`
            : `Executing 'Timer ${name} with duration ${duration}'`
        );
      } else {
        this.debug(
          name === "" ? "Executing 'Timer'" : `Executing 'Timer named ${name}'`
        );
      }
    }
    let wakeUpTime: bigint;
    try {
      wakeUpTime = checkU64(wakeUpTimeSinceUnixEpoch, "sleep duration");
    } catch (e) {
      if (e instanceof VMError) {
        this.hitError(e);
      }
      throw e;
    }
    const cid = this.context.journal.nextCompletionNotificationId();

    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        SleepCommand,
        create(SleepCommand.desc, {
          wake_up_time: wakeUpTime,
          result_completion_id: cid,
          name,
        }),
        cid,
        DEFAULT_PAYLOAD_OPTIONS
      )
    );
  }

  private checkTarget(target: Target) {
    if (target.idempotencyKey !== undefined && target.idempotencyKey === "") {
      this.hitError(EMPTY_IDEMPOTENCY_KEY.clone());
    }
    if (target.scope !== undefined && target.scope === "") {
      this.hitError(EMPTY_SCOPE.clone());
    }
    if (target.limitKey !== undefined && target.limitKey === "") {
      this.hitError(EMPTY_LIMIT_KEY.clone());
    }
    if (target.scope !== undefined) {
      this.verifyFeatureSupport("scope", Version.V7);
    }
    if (target.limitKey !== undefined) {
      this.verifyFeatureSupport("limit key", Version.V7);
    }
  }

  sysCall(
    target: Target,
    input: Uint8Array,
    name: string | undefined,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ): CallHandle {
    this.invocationDebugLogs(
      () => `Executing 'Call ${target.service}/${target.handler}'`
    );
    this.checkTarget(target);

    const callInvocationIdCompletionId =
      this.context.journal.nextCompletionNotificationId();
    const resultCompletionId =
      this.context.journal.nextCompletionNotificationId();

    const handles = this.doTransition((s) =>
      this.sysCompletableEntryWithMultipleCompletions(
        s,
        CallCommand,
        create(CallCommand.desc, {
          service_name: target.service,
          handler_name: target.handler,
          key: target.key ?? "",
          idempotency_key: target.idempotencyKey,
          scope: target.scope,
          limit_key: target.limitKey,
          headers: target.headers.map((h) => ({ key: h.key, value: h.value })),
          parameter: input,
          invocation_id_notification_idx: callInvocationIdCompletionId,
          name: name ?? "",
          result_completion_id: resultCompletionId,
        }),
        [callInvocationIdCompletionId, resultCompletionId],
        options
      )
    );

    if (
      this.options.implicitCancellation.type === "enabled" &&
      this.options.implicitCancellation.cancelChildrenCalls
    ) {
      this.trackedInvocationIds.push({
        handle: handles[0]!,
        invocationId: undefined,
      });
    }

    return {
      invocationIdNotificationHandle: handles[0]!,
      callNotificationHandle: handles[1]!,
    };
  }

  /**
   * @param executionTimeSinceUnixEpoch when to execute the call, in millis since unix epoch. `undefined` for immediate execution.
   */
  sysSend(
    target: Target,
    input: Uint8Array,
    executionTimeSinceUnixEpoch: bigint | undefined,
    name: string | undefined,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ): SendHandle {
    this.invocationDebugLogs(
      () => `Executing 'Send to ${target.service}/${target.handler}'`
    );
    this.checkTarget(target);

    let invokeTime: bigint;
    try {
      invokeTime = checkU64(executionTimeSinceUnixEpoch ?? 0n, "send delay");
    } catch (e) {
      if (e instanceof VMError) {
        this.hitError(e);
      }
      throw e;
    }
    const callInvocationIdCompletionId =
      this.context.journal.nextCompletionNotificationId();
    const invocationIdNotificationHandle = this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        OneWayCallCommand,
        create(OneWayCallCommand.desc, {
          service_name: target.service,
          handler_name: target.handler,
          key: target.key ?? "",
          idempotency_key: target.idempotencyKey,
          scope: target.scope,
          limit_key: target.limitKey,
          headers: target.headers.map((h) => ({ key: h.key, value: h.value })),
          parameter: input,
          invoke_time: invokeTime,
          invocation_id_notification_idx: callInvocationIdCompletionId,
          name: name ?? "",
        }),
        callInvocationIdCompletionId,
        options
      )
    );

    if (
      this.options.implicitCancellation.type === "enabled" &&
      this.options.implicitCancellation.cancelChildrenOneWayCalls
    ) {
      this.trackedInvocationIds.push({
        handle: invocationIdNotificationHandle,
        invocationId: undefined,
      });
    }

    return { invocationIdNotificationHandle };
  }

  sysAwakeable(): AwakeableHandle {
    this.invocationDebugLogs(() => "Executing 'Create awakeable'");

    const sid = this.context.journal.nextSignalNotificationId();

    const handle = this.doTransition((s) =>
      this.createSignalHandleTransition(s, "awakeable", signalId(sid))
    );

    return {
      id: awakeableIdStr(this.context.expectStartInfo().id, sid),
      handle,
    };
  }

  sysCompleteAwakeable(
    id: string,
    value: NonEmptyValue,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ) {
    this.invocationDebugLogs(() => `Executing 'Complete awakeable ${id}'`);
    this.verifyErrorMetadataFeatureSupport(value);
    this.doTransition((s) => [
      this.sysNonCompletableEntry(
        s,
        CompleteAwakeableCommand,
        create(CompleteAwakeableCommand.desc, {
          awakeable_id: id,
          value:
            value.type === "success" ? { content: value.value } : undefined,
          failure:
            value.type === "failure"
              ? terminalFailureToFailure(value.failure)
              : undefined,
        }),
        options
      ),
      undefined,
    ]);
  }

  createSignalHandle(name: string): NotificationHandle {
    this.invocationDebugLogs(() => "Executing 'Create named signal'");

    return this.doTransition((s) =>
      this.createSignalHandleTransition(s, "named awakeable", signalName(name))
    );
  }

  sysCompleteSignal(
    targetInvocationId: string,
    name: string,
    value: NonEmptyValue
  ) {
    this.invocationDebugLogs(() => `Executing 'Complete named signal ${name}'`);
    this.verifyErrorMetadataFeatureSupport(value);
    this.doTransition((s) => [
      this.sysNonCompletableEntry(
        s,
        SendSignalCommand,
        create(SendSignalCommand.desc, {
          target_invocation_id: targetInvocationId,
          name,
          value:
            value.type === "success" ? { content: value.value } : undefined,
          failure:
            value.type === "failure"
              ? terminalFailureToFailure(value.failure)
              : undefined,
        }),
        DEFAULT_PAYLOAD_OPTIONS
      ),
      undefined,
    ]);
  }

  sysGetPromise(key: string): NotificationHandle {
    this.invocationDebugLogs(() => `Executing 'Await promise ${key}'`);

    const cid = this.context.journal.nextCompletionNotificationId();
    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        GetPromiseCommand,
        create(GetPromiseCommand.desc, { key, result_completion_id: cid }),
        cid,
        DEFAULT_PAYLOAD_OPTIONS
      )
    );
  }

  sysPeekPromise(key: string): NotificationHandle {
    this.invocationDebugLogs(() => `Executing 'Peek promise ${key}'`);

    const cid = this.context.journal.nextCompletionNotificationId();
    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        PeekPromiseCommand,
        create(PeekPromiseCommand.desc, { key, result_completion_id: cid }),
        cid,
        DEFAULT_PAYLOAD_OPTIONS
      )
    );
  }

  sysCompletePromise(
    key: string,
    value: NonEmptyValue,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ): NotificationHandle {
    this.invocationDebugLogs(() => `Executing 'Complete promise ${key}'`);
    this.verifyErrorMetadataFeatureSupport(value);

    const cid = this.context.journal.nextCompletionNotificationId();
    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        CompletePromiseCommand,
        create(CompletePromiseCommand.desc, {
          key,
          completion_value:
            value.type === "success" ? { content: value.value } : undefined,
          completion_failure:
            value.type === "failure"
              ? terminalFailureToFailure(value.failure)
              : undefined,
          result_completion_id: cid,
        }),
        cid,
        options
      )
    );
  }

  sysRun(name: string): RunHandle {
    const handle = this.doTransition((s) => this.sysRunTransition(s, name));
    if (this.logger.enabled(LogLevel.DEBUG) && !handle.replayed) {
      // Store the name, we need it later when completing
      this.sysRunNames.set(handle.handle, name);
    }
    return handle;
  }

  proposeRunCompletion(
    notificationHandle: NotificationHandle,
    value: RunExitResult,
    retryPolicy: RetryPolicy
  ) {
    if (this.logger.enabled(LogLevel.DEBUG)) {
      const name = this.sysRunNames.get(notificationHandle) ?? "";
      this.sysRunNames.delete(notificationHandle);
      switch (value.type) {
        case "success":
          this.invocationDebugLogs(
            () => `Journaling run '${name}' success result`
          );
          break;
        case "terminalFailure":
          this.invocationDebugLogs(
            () =>
              `Journaling run '${name}' terminal failure ${value.failure.code} result`
          );
          break;
        case "retryableFailure":
          this.invocationDebugLogs(
            () => `Propagating run '${name}' retryable failure`
          );
          break;
      }
    }
    if (value.type === "terminalFailure" && value.failure.metadata.length > 0) {
      this.verifyFeatureSupport("terminal error metadata", Version.V6);
    }
    if (shouldPauseOnMaxAttempts(retryPolicy)) {
      this.verifyFeatureSupport("pause", Version.V7);
    }

    this.doTransition((s) => [
      this.proposeRunCompletionTransition(
        s,
        notificationHandle,
        value,
        retryPolicy
      ),
      undefined,
    ]);
  }

  sysCancelInvocation(targetInvocationId: string) {
    this.invocationDebugLogs(
      () => `Executing 'Cancel invocation' of ${targetInvocationId}`
    );
    this.doTransition((s) => [
      this.sysNonCompletableEntry(
        s,
        SendSignalCommand,
        create(SendSignalCommand.desc, {
          target_invocation_id: targetInvocationId,
          idx: CANCEL_SIGNAL_ID,
          void: VOID,
        }),
        DEFAULT_PAYLOAD_OPTIONS
      ),
      undefined,
    ]);
  }

  private checkAttachTargetScope(target: AttachInvocationTarget) {
    if (
      (target.type === "workflowId" || target.type === "idempotencyId") &&
      target.scope !== undefined
    ) {
      if (target.scope === "") {
        this.hitError(EMPTY_SCOPE.clone());
      }
      this.verifyFeatureSupport("scope", Version.V7);
    }
  }

  private attachTargetFields(target: AttachInvocationTarget): {
    invocation_id?: string;
    idempotent_request_target?: IdempotentRequestTarget;
    workflow_target?: WorkflowTarget;
  } {
    switch (target.type) {
      case "invocationId":
        return { invocation_id: target.id };
      case "workflowId":
        return {
          workflow_target: {
            workflow_name: target.name,
            workflow_key: target.key,
            scope: target.scope,
          },
        };
      case "idempotencyId":
        return {
          idempotent_request_target: {
            service_name: target.serviceName,
            service_key: target.serviceKey,
            handler_name: target.handlerName,
            idempotency_key: target.idempotencyKey,
            scope: target.scope,
          },
        };
    }
  }

  sysAttachInvocation(target: AttachInvocationTarget): NotificationHandle {
    this.invocationDebugLogs(() => "Executing 'Attach invocation'");
    this.checkAttachTargetScope(target);

    const cid = this.context.journal.nextCompletionNotificationId();
    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        AttachInvocationCommand,
        create(AttachInvocationCommand.desc, {
          ...this.attachTargetFields(target),
          result_completion_id: cid,
        }),
        cid,
        DEFAULT_PAYLOAD_OPTIONS
      )
    );
  }

  sysGetInvocationOutput(target: AttachInvocationTarget): NotificationHandle {
    this.invocationDebugLogs(() => "Executing 'Get invocation output'");
    this.checkAttachTargetScope(target);

    const cid = this.context.journal.nextCompletionNotificationId();
    return this.doTransition((s) =>
      this.sysSimpleCompletableEntry(
        s,
        GetInvocationOutputCommand,
        create(GetInvocationOutputCommand.desc, {
          ...this.attachTargetFields(target),
          result_completion_id: cid,
        }),
        cid,
        DEFAULT_PAYLOAD_OPTIONS
      )
    );
  }

  sysWriteOutput(
    value: NonEmptyValue,
    options: PayloadOptions = DEFAULT_PAYLOAD_OPTIONS
  ) {
    this.invocationDebugLogs(() =>
      value.type === "success"
        ? "Writing invocation result success value"
        : "Writing invocation result failure value"
    );
    this.verifyErrorMetadataFeatureSupport(value);
    this.doTransition((s) => [
      this.sysNonCompletableEntry(
        s,
        OutputCommand,
        create(OutputCommand.desc, {
          value:
            value.type === "success" ? { content: value.value } : undefined,
          failure:
            value.type === "failure"
              ? terminalFailureToFailure(value.failure)
              : undefined,
        }),
        options
      ),
      undefined,
    ]);
  }

  sysEnd() {
    this.invocationDebugLogs(() => "End of the invocation");
    this.doTransition((s) => [this.sysEndTransition(s), undefined]);
  }

  /** Returns the current state of the state machine. */
  state(): VMState {
    if ("err" in this.lastTransition) {
      return VMState.Closed;
    }
    switch (this.lastTransition.ok.kind) {
      case "WaitingStart":
      case "WaitingReplayEntries":
        return VMState.WaitingPreFlight;
      case "Replaying":
        return VMState.Replaying;
      case "Processing":
        return VMState.Processing;
      case "Closed":
        return VMState.Closed;
    }
  }

  /** Returns last command index. Returns `-1` if there was no progress in the journal. */
  lastCommandIndex(): number {
    return this.context.journal.commandIndex();
  }

  /** Debug representation of the current future tree, for tests. */
  debugFuture(f: WasmUnresolvedFuture): string {
    return futureDebug(fromUnresolvedFuture(f));
  }

  /** Test helper: resolve an unresolved future to the wire representation. */
  resolveUnresolvedFuture(
    f: WasmUnresolvedFuture
  ): import("./messages.js").Future {
    if ("ok" in this.lastTransition && isExecuting(this.lastTransition.ok)) {
      return this.lastTransition.ok.asyncResults.resolveUnresolvedFuture(
        fromUnresolvedFuture(f)
      );
    }
    throw new Error("Could not resolve unresolved future");
  }
}

function checkEntryHeaderMatch<M extends object>(
  commandIndex: number,
  def: CommandMessageDef<M>,
  actual: M,
  expected: M,
  ignorePayloadEquality: boolean
) {
  if (!def.headerEq(actual, expected, ignorePayloadEquality)) {
    throw commandMismatchError(commandIndex, def, actual, expected);
  }
}

// Re-export for the bindings layer
export type { CommandType };
