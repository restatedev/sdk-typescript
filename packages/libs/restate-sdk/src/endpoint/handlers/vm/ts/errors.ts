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
 * Error model of the shared core, mirrors `error.rs` and `vm/errors.rs`.
 */

import { compareUtf8, create, type MessageDesc } from "./proto.js";
import {
  DiffFormatter,
  ErrorBehavior,
  ErrorMessageDesc,
  MessageType,
  messageTypeDebugName,
  type CommandMessageDef,
  type ErrorMessage,
} from "./messages.js";
import {
  CANCEL_NOTIFICATION_HANDLE,
  messageTypeDisplay,
  notificationIdDebug,
  notificationIdKey,
  type NotificationId,
} from "./types.js";
import { versionToString, type Version } from "./version.js";

// --- Error codes

export const codes = {
  BAD_REQUEST: 400,
  INTERNAL: 500,
  UNSUPPORTED_MEDIA_TYPE: 415,
  JOURNAL_MISMATCH: 570,
  PROTOCOL_VIOLATION: 571,
  AWAITING_TWO_ASYNC_RESULTS: 572,
  UNSUPPORTED_FEATURE: 573,
  CLOSED: 598,
  SUSPENDED: 599,
} as const;

// --- Command metadata

export interface CommandMetadata {
  readonly index: number;
  readonly ty: MessageType;
  readonly name?: string;
}

export function commandMetadataDisplay(cmd: CommandMetadata): string {
  let s = `${messageTypeDisplay(cmd.ty)} `;
  if (cmd.name !== undefined) {
    s += `[${cmd.name}]`;
  } else {
    s += `[${cmd.index}]`;
  }
  return s;
}

export type NotificationMetadata =
  | { readonly type: "relatedToCommand"; readonly command: CommandMetadata }
  | { readonly type: "awakeable"; readonly id: string }
  | { readonly type: "cancellation" };

export function notificationMetadataDisplay(m: NotificationMetadata): string {
  switch (m.type) {
    case "relatedToCommand":
      return commandMetadataDisplay(m.command);
    case "awakeable":
      return `Awakeable ${m.id}`;
    case "cancellation":
      return "Cancellation";
  }
}

// --- Error type

/**
 * VM error. Converted to the `WasmFailure` shape when thrown to the SDK by the
 * bindings layer.
 */
export class VMError extends Error {
  code: number;
  stacktrace: string;
  relatedCommand: CommandMetadata | undefined;
  /** millis, `Infinity` represents a saturated duration */
  nextRetryDelay: number | undefined;
  behavior: ErrorBehavior;

  constructor(
    code: number,
    message: string,
    stacktrace = "",
    relatedCommand: CommandMetadata | undefined = undefined,
    nextRetryDelay: number | undefined = undefined,
    behavior: ErrorBehavior = ErrorBehavior.Retry
  ) {
    super(message);
    this.name = "VMError";
    this.code = code;
    this.stacktrace = stacktrace;
    this.relatedCommand = relatedCommand;
    this.nextRetryDelay = nextRetryDelay;
    this.behavior = behavior;
  }

  static internal(message: string): VMError {
    return new VMError(codes.INTERNAL, message);
  }

  clone(): VMError {
    return new VMError(
      this.code,
      this.message,
      this.stacktrace,
      this.relatedCommand,
      this.nextRetryDelay,
      this.behavior
    );
  }

  withStacktrace(stacktrace: string): this {
    this.stacktrace = stacktrace;
    return this;
  }

  withNextRetryDelayOverride(delayMillis: number): this {
    this.nextRetryDelay = delayMillis;
    return this;
  }

  withShouldPause(shouldPause: boolean): this {
    this.behavior = shouldPause ? ErrorBehavior.Pause : ErrorBehavior.Retry;
    return this;
  }

  withRelatedCommandMetadata(relatedCommand: CommandMetadata): this {
    this.relatedCommand = relatedCommand;
    return this;
  }

  isSuspendedError(): boolean {
    // Rust compares the whole `Error` against the `SUSPENDED` constant, so a
    // decorated copy of it is not a suspension.
    return (
      this.code === SUSPENDED.code &&
      this.message === SUSPENDED.message &&
      this.stacktrace === SUSPENDED.stacktrace &&
      this.relatedCommand === undefined &&
      this.nextRetryDelay === undefined &&
      this.behavior === SUSPENDED.behavior
    );
  }

  /** Same as the Rust `Display` impl. */
  override toString(): string {
    let s = `(${this.code}) ${this.message}`;
    if (this.stacktrace !== "") {
      s += `\nStacktrace: ${this.stacktrace}`;
    }
    if (this.relatedCommand !== undefined) {
      s += `\nRelated command: ${commandMetadataDisplay(this.relatedCommand)}`;
    }
    return s;
  }

  asErrorMessage(): ErrorMessage {
    const relatedCommandName = this.relatedCommand?.name;
    return create(ErrorMessageDesc, {
      code: this.code,
      message: this.message,
      stacktrace: this.stacktrace,
      related_command_index: this.relatedCommand?.index,
      related_command_name:
        relatedCommandName !== undefined && relatedCommandName !== ""
          ? relatedCommandName
          : undefined,
      related_command_type:
        this.relatedCommand !== undefined
          ? this.relatedCommand.ty & 0xffff
          : undefined,
      next_retry_delay:
        this.nextRetryDelay !== undefined
          ? saturatingMillisToU64(this.nextRetryDelay)
          : undefined,
      behavior: this.behavior,
    });
  }
}

const U64_MAX = (1n << 64n) - 1n;

export function saturatingMillisToU64(millis: number): bigint {
  if (!Number.isFinite(millis) || millis < 0) {
    return millis < 0 ? 0n : U64_MAX;
  }
  const b = BigInt(Math.floor(millis));
  return b > U64_MAX ? U64_MAX : b;
}

export function isVMError(e: unknown): e is VMError {
  return e instanceof VMError;
}

// --- Const errors

function constError(code: number, message: string): VMError {
  return new VMError(code, message);
}

export const MISSING_CONTENT_TYPE = constError(
  codes.UNSUPPORTED_MEDIA_TYPE,
  "Missing content type when invoking the service deployment"
);

export const UNEXPECTED_INPUT_MESSAGE = constError(
  codes.PROTOCOL_VIOLATION,
  "Expected incoming message to be an entry"
);

export const KNOWN_ENTRIES_IS_ZERO = constError(
  codes.INTERNAL,
  "Known entries is zero, expected >= 1"
);

export const UNEXPECTED_ENTRY_MESSAGE = constError(
  codes.PROTOCOL_VIOLATION,
  "Expected entry messages only when waiting replay entries"
);

export const INPUT_CLOSED_WHILE_WAITING_ENTRIES = constError(
  codes.PROTOCOL_VIOLATION,
  "The input was closed while still waiting to receive all journal to replay"
);

export const EMPTY_IDEMPOTENCY_KEY = constError(
  codes.INTERNAL,
  "Trying to execute an idempotent request with an empty idempotency key. The idempotency key must be non-empty."
);

export const EMPTY_LIMIT_KEY = constError(
  codes.INTERNAL,
  "Trying to execute a request with an empty limit key. The limit key must be non-empty."
);

export const EMPTY_SCOPE = constError(
  codes.INTERNAL,
  "Trying to execute a request with an empty scope. The scope must be non-empty."
);

export const SUSPENDED = constError(codes.SUSPENDED, "Suspended invocation");

export const EMPTY_GET_EAGER_STATE = constError(
  codes.PROTOCOL_VIOLATION,
  "Unexpected empty value variant for get eager state."
);

export const EMPTY_GET_EAGER_STATE_KEYS = constError(
  codes.PROTOCOL_VIOLATION,
  "Unexpected empty value variant for state keys."
);

// --- Other errors (constructors returning a fresh VMError)

export function unavailableEntryError(expected: MessageType): VMError {
  return new VMError(
    codes.PROTOCOL_VIOLATION,
    `The execution replay ended unexpectedly. Expecting to read '${messageTypeDisplay(expected)}' from the recorded journal, but the buffered messages were already drained.`
  );
}

export function unexpectedStateError(state: string, event: string): VMError {
  return new VMError(
    codes.PROTOCOL_VIOLATION,
    `Unexpected state '${JSON.stringify(state)}' when invoking '${JSON.stringify(event)}'`
  );
}

export function closedError(event: string): VMError {
  return new VMError(
    codes.CLOSED,
    `State machine was closed when invoking '${event}'`
  );
}

export function commandTypeMismatchError(
  commandIndex: number,
  actual: MessageType,
  expected: MessageType
): VMError {
  return new VMError(
    codes.JOURNAL_MISMATCH,
    `Found a mismatch between the code paths taken during the previous execution and the paths taken during this execution.
This typically happens when some parts of the code are non-deterministic.
 - The previous execution ran and recorded the following: '${messageTypeDisplay(expected)}' (index '${commandIndex}')
 - The current execution attempts to perform the following: '${messageTypeDisplay(actual)}'`
  );
}

export function commandMismatchError<M extends object>(
  commandIndex: number,
  def: CommandMessageDef<M>,
  actual: M,
  expected: M
): VMError {
  const f = new DiffFormatter("   ");
  def.writeDiff(actual, expected, f);
  return new VMError(
    codes.JOURNAL_MISMATCH,
    `Found a mismatch between the code paths taken during the previous execution and the paths taken during this execution.
This typically happens when some parts of the code are non-deterministic.
- The mismatch happened while executing '${messageTypeDisplay(def.ty)}' (index '${commandIndex}')
- Difference:${f.toString()}`
  );
}

export function uncompletedDoProgressDuringReplay(
  notificationIds: NotificationId[],
  additionalKnownMetadata: Map<string, NotificationMetadata>
): VMError {
  // Order notifications: completions first (by id), then named signals, then unnamed signals (awakeables by id), then built-in signals last
  const ordered = [...notificationIds].sort((a, b) => {
    if (a.type === "completion" && b.type === "completion") {
      return a.id - b.id;
    }
    if (a.type === "completion") {
      return -1;
    }
    if (b.type === "completion") {
      return 1;
    }
    if (a.type === "name" && b.type === "name") {
      return compareUtf8(a.name, b.name);
    }
    if (a.type === "name" && b.type === "signal") {
      return -1;
    }
    if (a.type === "signal" && b.type === "name") {
      return 1;
    }
    // Both signal ids
    const aId = (a as { id: number }).id;
    const bId = (b as { id: number }).id;
    const aIsCancel = aId === CANCEL_NOTIFICATION_HANDLE;
    const bIsCancel = bId === CANCEL_NOTIFICATION_HANDLE;
    if (aIsCancel && !bIsCancel) {
      return 1;
    }
    if (!aIsCancel && bIsCancel) {
      return -1;
    }
    return aId - bId;
  });

  let msg = `Found a mismatch between the code paths taken during the previous execution and the paths taken during this execution.
'await' could not be replayed. This usually means the code was mutated adding an 'await' without registering a new service revision.
Notifications awaited on this await point:`;

  for (const notificationId of ordered) {
    msg += "\n - ";
    const metadata = additionalKnownMetadata.get(
      notificationIdKey(notificationId)
    );
    if (metadata !== undefined) {
      msg += notificationMetadataDisplay(metadata);
    } else {
      switch (notificationId.type) {
        case "completion":
          msg += `completion id ${notificationId.id}`;
          break;
        case "signal":
          msg += `signal [${notificationId.id}]`;
          break;
        case "name":
          msg += `Named signal: ${notificationId.name}`;
          break;
      }
    }
  }

  return new VMError(codes.JOURNAL_MISMATCH, msg);
}

export function badEagerStateKeyError(cause: string): VMError {
  return new VMError(
    codes.INTERNAL,
    `Cannot convert a eager state key into UTF-8 String: ${cause}`
  );
}

export function unsupportedFeatureForNegotiatedVersion(
  feature: string,
  currentVersion: Version,
  minimumRequiredVersion: Version
): VMError {
  return new VMError(
    codes.UNSUPPORTED_FEATURE,
    `Feature '${feature}' is not supported by the negotiated protocol version '${versionToString(currentVersion)}', the minimum required version is '${versionToString(minimumRequiredVersion)}'`
  );
}

export function badProposeRunCompletionAck(completionId: number): VMError {
  return new VMError(
    codes.PROTOCOL_VIOLATION,
    `Received a run completion ack for completion id ${completionId}, but the related run was not proposed during this attempt.`
  );
}

export function outOfBoundsDuration(what: string, cause: string): VMError {
  return new VMError(
    codes.INTERNAL,
    `The provided duration for '${what}' is out of bounds: ${cause}`
  );
}

// --- Decoding errors

export type DecodingErrorKind =
  | "DecodeMessage"
  | "UnexpectedMessageType"
  | "MissingField"
  | "UnknownMessageType";

export class DecodingError extends Error {
  constructor(
    readonly kind: DecodingErrorKind,
    message: string
  ) {
    super(message);
    this.name = "DecodingError";
  }

  static decodeMessage(ty: MessageType, cause: unknown): DecodingError {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new DecodingError(
      "DecodeMessage",
      `cannot decode protocol message type ${messageTypeDebugName(ty)}. Reason: ${JSON.stringify(reason)}`
    );
  }

  static unexpectedMessageType(
    commandIndex: number,
    actual: MessageType,
    expected: MessageType
  ): DecodingError {
    return new DecodingError(
      "UnexpectedMessageType",
      commandTypeMismatchError(commandIndex, actual, expected).message
    );
  }

  static missingField(expected: MessageType, field: string): DecodingError {
    return new DecodingError(
      "MissingField",
      `expected message type ${messageTypeDebugName(expected)} to have field ${field}`
    );
  }

  static unknownMessageType(code: number): DecodingError {
    return new DecodingError(
      "UnknownMessageType",
      `unknown protocol.message code 0x${code.toString(16)}`
    );
  }

  toVMError(): VMError {
    return new VMError(
      this.kind === "UnexpectedMessageType"
        ? codes.JOURNAL_MISMATCH
        : codes.INTERNAL,
      this.message
    );
  }
}

/** Debug rendering of a notification id set, used in error messages. */
export function debugNotificationIds(ids: NotificationId[]): string {
  return `[${ids.map(notificationIdDebug).join(", ")}]`;
}

// Re-exported for convenience of the vm module
export type { MessageDesc };
