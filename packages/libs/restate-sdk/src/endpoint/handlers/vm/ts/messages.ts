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
 * Service protocol message types, headers and the protobuf message
 * definitions of `dev.restate.service.protocol`.
 *
 * Mirrors `service_protocol/header.rs`, `service_protocol/messages.rs` and the
 * generated prost structs in the shared core.
 */

import {
  bytesEqual,
  create,
  desc,
  encodeMessage,
  messageEquals,
  ProtoWriter,
  utf8Decode,
  type MessageDesc,
} from "./proto.js";
import { Version } from "./version.js";

// ---------------------------------------------------------------------------
// Message types & header
// ---------------------------------------------------------------------------

const COMMAND_ENTRY_MASK = 0x0400;
const NOTIFICATION_ENTRY_MASK = 0x8000;
const CUSTOM_ENTRY_MASK = 0xfc00;

export enum MessageType {
  Start = 0x0000,
  Suspension = 0x0001,
  Error = 0x0002,
  End = 0x0003,
  ProposeRunCompletion = 0x0005,
  AwaitingOn = 0x0006,
  ProposeRunCompletionAck = 0x0007,
  InputCommand = 0x0400,
  OutputCommand = 0x0401,
  GetLazyStateCommand = 0x0402,
  GetLazyStateCompletionNotification = 0x8002,
  SetStateCommand = 0x0403,
  ClearStateCommand = 0x0404,
  ClearAllStateCommand = 0x0405,
  GetLazyStateKeysCommand = 0x0406,
  GetLazyStateKeysCompletionNotification = 0x8006,
  GetEagerStateCommand = 0x0407,
  GetEagerStateKeysCommand = 0x0408,
  GetPromiseCommand = 0x0409,
  GetPromiseCompletionNotification = 0x8009,
  PeekPromiseCommand = 0x040a,
  PeekPromiseCompletionNotification = 0x800a,
  CompletePromiseCommand = 0x040b,
  CompletePromiseCompletionNotification = 0x800b,
  SleepCommand = 0x040c,
  SleepCompletionNotification = 0x800c,
  CallCommand = 0x040d,
  CallInvocationIdCompletionNotification = 0x800e,
  CallCompletionNotification = 0x800d,
  OneWayCallCommand = 0x040e,
  SendSignalCommand = 0x0410,
  RunCommand = 0x0411,
  RunCompletionNotification = 0x8011,
  AttachInvocationCommand = 0x0412,
  AttachInvocationCompletionNotification = 0x8012,
  GetInvocationOutputCommand = 0x0413,
  GetInvocationOutputCompletionNotification = 0x8013,
  CompleteAwakeableCommand = 0x0414,
  SignalNotification = 0xfbff,
}

export class UnknownMessageType extends Error {
  constructor(readonly code: number) {
    super(`unknown protocol.message code 0x${code.toString(16)}`);
    this.name = "UnknownMessageType";
  }
}

/**
 * Parses a message type code. Custom entries (any code with the custom entry
 * mask set) are accepted as-is, like the Rust `MessageType::CustomEntry`.
 */
export function messageTypeFromCode(code: number): MessageType {
  if (MessageType[code] !== undefined) {
    return code as MessageType;
  }
  if ((code & CUSTOM_ENTRY_MASK) !== 0) {
    return code as MessageType;
  }
  throw new UnknownMessageType(code);
}

export function isCommandMessageType(ty: MessageType): boolean {
  const code: number = ty;
  return code >= COMMAND_ENTRY_MASK && code < NOTIFICATION_ENTRY_MASK;
}

export function isNotificationMessageType(ty: MessageType): boolean {
  const code: number = ty;
  return code >= NOTIFICATION_ENTRY_MASK && code < CUSTOM_ENTRY_MASK;
}

export function messageTypeAllowsAck(ty: MessageType): boolean {
  return ty === MessageType.ProposeRunCompletion;
}

/** Same as the Rust `Debug` representation of `MessageType`. */
export function messageTypeDebugName(ty: MessageType): string {
  const name = MessageType[ty];
  if (name !== undefined) {
    return name;
  }
  return `CustomEntry(${ty})`;
}

export const CANCEL_SIGNAL_ID = 1;

export interface MessageHeader {
  readonly ty: MessageType;
  readonly length: number;
  /** `undefined` when the message type doesn't carry the flag. */
  readonly requestedAck?: boolean;
}

const REQUESTED_ACK_FLAG_HI = 0x8000;

/** Encodes the 8 byte protocol header. */
export function encodeHeader(h: MessageHeader): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  let hi = (h.ty & 0xffff) * 0x10000; // ty << 16, without sign issues
  if (h.requestedAck === true) {
    hi |= REQUESTED_ACK_FLAG_HI;
  }
  view.setUint32(0, hi >>> 0, false);
  view.setUint32(4, h.length >>> 0, false);
  return out;
}

export function decodeHeader(buf: Uint8Array, offset = 0): MessageHeader {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  const hi = view.getUint32(0, false);
  const length = view.getUint32(4, false);
  const ty = messageTypeFromCode(hi >>> 16);
  const requestedAck = messageTypeAllowsAck(ty)
    ? (hi & REQUESTED_ACK_FLAG_HI) !== 0
    : undefined;
  return { ty, length, requestedAck };
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum CombinatorType {
  Unknown = 0,
  FirstCompleted = 1,
  AllCompleted = 2,
  FirstSucceededOrAllFailed = 3,
  AllSucceededOrFirstFailed = 4,
}

export enum ErrorBehavior {
  Retry = 0,
  Pause = 1,
  Fail = 2,
}

// ---------------------------------------------------------------------------
// Nested messages
// ---------------------------------------------------------------------------

export interface Value {
  content: Uint8Array;
}
export const ValueDesc = desc<Value>("Value", [
  { no: 1, name: "content", kind: "bytes" },
]);

export interface Void {}
export const VoidDesc = desc<Void>("Void", []);
export const VOID: Void = {};

export interface FailureMetadata {
  key: string;
  value: string;
}
export const FailureMetadataDesc = desc<FailureMetadata>("FailureMetadata", [
  { no: 1, name: "key", kind: "string" },
  { no: 2, name: "value", kind: "string" },
]);

export interface Failure {
  code: number;
  message: string;
  metadata: FailureMetadata[];
}
export const FailureDesc = desc<Failure>("Failure", [
  { no: 1, name: "code", kind: "uint32" },
  { no: 2, name: "message", kind: "string" },
  {
    no: 3,
    name: "metadata",
    kind: "message",
    message: FailureMetadataDesc,
    repeated: true,
  },
]);

export interface Header {
  key: string;
  value: string;
}
export const HeaderDesc = desc<Header>("Header", [
  { no: 1, name: "key", kind: "string" },
  { no: 2, name: "value", kind: "string" },
]);

export interface StateKeys {
  keys: Uint8Array[];
}
export const StateKeysDesc = desc<StateKeys>("StateKeys", [
  { no: 1, name: "keys", kind: "bytes", repeated: true },
]);

export interface WorkflowTarget {
  workflow_name: string;
  workflow_key: string;
  scope?: string;
}
export const WorkflowTargetDesc = desc<WorkflowTarget>("WorkflowTarget", [
  { no: 1, name: "workflow_name", kind: "string" },
  { no: 2, name: "workflow_key", kind: "string" },
  { no: 3, name: "scope", kind: "string", presence: true },
]);

export interface IdempotentRequestTarget {
  service_name: string;
  service_key?: string;
  handler_name: string;
  idempotency_key: string;
  scope?: string;
}
export const IdempotentRequestTargetDesc = desc<IdempotentRequestTarget>(
  "IdempotentRequestTarget",
  [
    { no: 1, name: "service_name", kind: "string" },
    { no: 2, name: "service_key", kind: "string", presence: true },
    { no: 3, name: "handler_name", kind: "string" },
    { no: 4, name: "idempotency_key", kind: "string" },
    { no: 5, name: "scope", kind: "string", presence: true },
  ]
);

// ---------------------------------------------------------------------------
// Core frames
// ---------------------------------------------------------------------------

export interface StateEntry {
  key: Uint8Array;
  value: Uint8Array;
}
export const StateEntryDesc = desc<StateEntry>("StartMessage.StateEntry", [
  { no: 1, name: "key", kind: "bytes" },
  { no: 2, name: "value", kind: "bytes" },
]);

export interface StartMessage {
  id: Uint8Array;
  debug_id: string;
  known_entries: number;
  state_map: StateEntry[];
  partial_state: boolean;
  key: string;
  retry_count_since_last_stored_entry: number;
  duration_since_last_stored_entry: bigint;
  random_seed: bigint;
  scope?: string;
  limit_key?: string;
  idempotency_key?: string;
}
export const StartMessageDesc = desc<StartMessage>("StartMessage", [
  { no: 1, name: "id", kind: "bytes" },
  { no: 2, name: "debug_id", kind: "string" },
  { no: 3, name: "known_entries", kind: "uint32" },
  {
    no: 4,
    name: "state_map",
    kind: "message",
    message: StateEntryDesc,
    repeated: true,
  },
  { no: 5, name: "partial_state", kind: "bool" },
  { no: 6, name: "key", kind: "string" },
  { no: 7, name: "retry_count_since_last_stored_entry", kind: "uint32" },
  { no: 8, name: "duration_since_last_stored_entry", kind: "uint64" },
  { no: 9, name: "random_seed", kind: "uint64" },
  { no: 10, name: "scope", kind: "string", presence: true },
  { no: 11, name: "limit_key", kind: "string", presence: true },
  { no: 12, name: "idempotency_key", kind: "string", presence: true },
]);

export interface Future {
  waiting_completions: number[];
  waiting_signals: number[];
  waiting_named_signals: string[];
  nested_futures: Future[];
  combinator_type: CombinatorType;
}
export const FutureDesc: MessageDesc<Future> = desc<Future>("Future", [
  { no: 1, name: "waiting_completions", kind: "uint32", repeated: true },
  { no: 2, name: "waiting_signals", kind: "uint32", repeated: true },
  { no: 3, name: "waiting_named_signals", kind: "string", repeated: true },
  {
    no: 4,
    name: "nested_futures",
    kind: "message",
    // Recursive: patched below
    message: undefined as unknown as MessageDesc<object>,
    repeated: true,
  },
  { no: 5, name: "combinator_type", kind: "enum" },
]);
// Patch the recursive reference
(FutureDesc.fields[3] as { message?: MessageDesc<object> }).message =
  FutureDesc as MessageDesc<object>;

export interface SuspensionMessage {
  awaiting_on?: Future;
}
export const SuspensionMessageDesc = desc<SuspensionMessage>(
  "SuspensionMessage",
  [{ no: 4, name: "awaiting_on", kind: "message", message: FutureDesc }]
);

/** Pre-V7 suspension message layout, used to transcode for old protocol versions. */
interface SuspensionMessageV6 {
  waiting_completions: number[];
  waiting_signals: number[];
  waiting_named_signals: string[];
}
const SuspensionMessageV6Desc = desc<SuspensionMessageV6>(
  "SuspensionMessageV6",
  [
    { no: 1, name: "waiting_completions", kind: "uint32", repeated: true },
    { no: 2, name: "waiting_signals", kind: "uint32", repeated: true },
    { no: 3, name: "waiting_named_signals", kind: "string", repeated: true },
  ]
);

export interface ErrorMessage {
  code: number;
  message: string;
  stacktrace: string;
  related_command_index?: number;
  related_command_name?: string;
  related_command_type?: number;
  next_retry_delay?: bigint;
  behavior: ErrorBehavior;
}
export const ErrorMessageDesc = desc<ErrorMessage>("ErrorMessage", [
  { no: 1, name: "code", kind: "uint32" },
  { no: 2, name: "message", kind: "string" },
  { no: 3, name: "stacktrace", kind: "string" },
  { no: 4, name: "related_command_index", kind: "uint32", presence: true },
  { no: 5, name: "related_command_name", kind: "string", presence: true },
  { no: 6, name: "related_command_type", kind: "uint32", presence: true },
  { no: 8, name: "next_retry_delay", kind: "uint64", presence: true },
  { no: 9, name: "behavior", kind: "enum" },
]);

export interface EndMessage {}
export const EndMessageDesc = desc<EndMessage>("EndMessage", []);

export interface ProposeRunCompletionMessage {
  result_completion_id: number;
  value?: Uint8Array;
  failure?: Failure;
}
export const ProposeRunCompletionMessageDesc =
  desc<ProposeRunCompletionMessage>("ProposeRunCompletionMessage", [
    { no: 1, name: "result_completion_id", kind: "uint32" },
    { no: 14, name: "value", kind: "bytes", presence: true, oneof: "result" },
    {
      no: 15,
      name: "failure",
      kind: "message",
      message: FailureDesc,
      oneof: "result",
    },
  ]);

export interface AwaitingOnMessage {
  awaiting_on?: Future;
  executing_side_effects: boolean;
}
export const AwaitingOnMessageDesc = desc<AwaitingOnMessage>(
  "AwaitingOnMessage",
  [
    { no: 1, name: "awaiting_on", kind: "message", message: FutureDesc },
    { no: 2, name: "executing_side_effects", kind: "bool" },
  ]
);

export interface ProposeRunCompletionAckMessage {
  completion_id: number;
}
export const ProposeRunCompletionAckMessageDesc =
  desc<ProposeRunCompletionAckMessage>("ProposeRunCompletionAckMessage", [
    { no: 1, name: "completion_id", kind: "uint32" },
  ]);

// ---------------------------------------------------------------------------
// Notifications (duck typed through NotificationTemplate)
// ---------------------------------------------------------------------------

export interface NotificationTemplate {
  completion_id?: number;
  signal_id?: number;
  signal_name?: string;
  void?: Void;
  value?: Value;
  failure?: Failure;
  invocation_id?: string;
  state_keys?: StateKeys;
}
export const NotificationTemplateDesc = desc<NotificationTemplate>(
  "NotificationTemplate",
  [
    {
      no: 1,
      name: "completion_id",
      kind: "uint32",
      presence: true,
      oneof: "id",
    },
    { no: 2, name: "signal_id", kind: "uint32", presence: true, oneof: "id" },
    { no: 3, name: "signal_name", kind: "string", presence: true, oneof: "id" },
    {
      no: 4,
      name: "void",
      kind: "message",
      message: VoidDesc,
      oneof: "result",
    },
    {
      no: 5,
      name: "value",
      kind: "message",
      message: ValueDesc,
      oneof: "result",
    },
    {
      no: 6,
      name: "failure",
      kind: "message",
      message: FailureDesc,
      oneof: "result",
    },
    {
      no: 16,
      name: "invocation_id",
      kind: "string",
      presence: true,
      oneof: "result",
    },
    {
      no: 17,
      name: "state_keys",
      kind: "message",
      message: StateKeysDesc,
      oneof: "result",
    },
  ]
);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface InputCommandMessage {
  headers: Header[];
  value?: Value;
  name: string;
}
export const InputCommandMessageDesc = desc<InputCommandMessage>(
  "InputCommandMessage",
  [
    {
      no: 1,
      name: "headers",
      kind: "message",
      message: HeaderDesc,
      repeated: true,
    },
    { no: 14, name: "value", kind: "message", message: ValueDesc },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface OutputCommandMessage {
  value?: Value;
  failure?: Failure;
  name: string;
}
export const OutputCommandMessageDesc = desc<OutputCommandMessage>(
  "OutputCommandMessage",
  [
    {
      no: 14,
      name: "value",
      kind: "message",
      message: ValueDesc,
      oneof: "result",
    },
    {
      no: 15,
      name: "failure",
      kind: "message",
      message: FailureDesc,
      oneof: "result",
    },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface GetLazyStateCommandMessage {
  key: Uint8Array;
  result_completion_id: number;
  name: string;
}
export const GetLazyStateCommandMessageDesc = desc<GetLazyStateCommandMessage>(
  "GetLazyStateCommandMessage",
  [
    { no: 1, name: "key", kind: "bytes" },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface SetStateCommandMessage {
  key: Uint8Array;
  value?: Value;
  name: string;
}
export const SetStateCommandMessageDesc = desc<SetStateCommandMessage>(
  "SetStateCommandMessage",
  [
    { no: 1, name: "key", kind: "bytes" },
    { no: 3, name: "value", kind: "message", message: ValueDesc },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface ClearStateCommandMessage {
  key: Uint8Array;
  name: string;
}
export const ClearStateCommandMessageDesc = desc<ClearStateCommandMessage>(
  "ClearStateCommandMessage",
  [
    { no: 1, name: "key", kind: "bytes" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface ClearAllStateCommandMessage {
  name: string;
}
export const ClearAllStateCommandMessageDesc =
  desc<ClearAllStateCommandMessage>("ClearAllStateCommandMessage", [
    { no: 12, name: "name", kind: "string" },
  ]);

export interface GetLazyStateKeysCommandMessage {
  result_completion_id: number;
  name: string;
}
export const GetLazyStateKeysCommandMessageDesc =
  desc<GetLazyStateKeysCommandMessage>("GetLazyStateKeysCommandMessage", [
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface GetEagerStateCommandMessage {
  key: Uint8Array;
  void?: Void;
  value?: Value;
  name: string;
}
export const GetEagerStateCommandMessageDesc =
  desc<GetEagerStateCommandMessage>("GetEagerStateCommandMessage", [
    { no: 1, name: "key", kind: "bytes" },
    {
      no: 13,
      name: "void",
      kind: "message",
      message: VoidDesc,
      oneof: "result",
    },
    {
      no: 14,
      name: "value",
      kind: "message",
      message: ValueDesc,
      oneof: "result",
    },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface GetEagerStateKeysCommandMessage {
  value?: StateKeys;
  name: string;
}
export const GetEagerStateKeysCommandMessageDesc =
  desc<GetEagerStateKeysCommandMessage>("GetEagerStateKeysCommandMessage", [
    { no: 14, name: "value", kind: "message", message: StateKeysDesc },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface GetPromiseCommandMessage {
  key: string;
  result_completion_id: number;
  name: string;
}
export const GetPromiseCommandMessageDesc = desc<GetPromiseCommandMessage>(
  "GetPromiseCommandMessage",
  [
    { no: 1, name: "key", kind: "string" },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface PeekPromiseCommandMessage {
  key: string;
  result_completion_id: number;
  name: string;
}
export const PeekPromiseCommandMessageDesc = desc<PeekPromiseCommandMessage>(
  "PeekPromiseCommandMessage",
  [
    { no: 1, name: "key", kind: "string" },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface CompletePromiseCommandMessage {
  key: string;
  completion_value?: Value;
  completion_failure?: Failure;
  result_completion_id: number;
  name: string;
}
export const CompletePromiseCommandMessageDesc =
  desc<CompletePromiseCommandMessage>("CompletePromiseCommandMessage", [
    { no: 1, name: "key", kind: "string" },
    {
      no: 2,
      name: "completion_value",
      kind: "message",
      message: ValueDesc,
      oneof: "completion",
    },
    {
      no: 3,
      name: "completion_failure",
      kind: "message",
      message: FailureDesc,
      oneof: "completion",
    },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface SleepCommandMessage {
  wake_up_time: bigint;
  result_completion_id: number;
  name: string;
}
export const SleepCommandMessageDesc = desc<SleepCommandMessage>(
  "SleepCommandMessage",
  [
    { no: 1, name: "wake_up_time", kind: "uint64" },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface CallCommandMessage {
  service_name: string;
  handler_name: string;
  parameter: Uint8Array;
  headers: Header[];
  key: string;
  idempotency_key?: string;
  scope?: string;
  limit_key?: string;
  invocation_id_notification_idx: number;
  result_completion_id: number;
  name: string;
}
export const CallCommandMessageDesc = desc<CallCommandMessage>(
  "CallCommandMessage",
  [
    { no: 1, name: "service_name", kind: "string" },
    { no: 2, name: "handler_name", kind: "string" },
    { no: 3, name: "parameter", kind: "bytes" },
    {
      no: 4,
      name: "headers",
      kind: "message",
      message: HeaderDesc,
      repeated: true,
    },
    { no: 5, name: "key", kind: "string" },
    { no: 6, name: "idempotency_key", kind: "string", presence: true },
    { no: 7, name: "scope", kind: "string", presence: true },
    { no: 8, name: "limit_key", kind: "string", presence: true },
    { no: 10, name: "invocation_id_notification_idx", kind: "uint32" },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface OneWayCallCommandMessage {
  service_name: string;
  handler_name: string;
  parameter: Uint8Array;
  invoke_time: bigint;
  headers: Header[];
  key: string;
  idempotency_key?: string;
  scope?: string;
  limit_key?: string;
  invocation_id_notification_idx: number;
  name: string;
}
export const OneWayCallCommandMessageDesc = desc<OneWayCallCommandMessage>(
  "OneWayCallCommandMessage",
  [
    { no: 1, name: "service_name", kind: "string" },
    { no: 2, name: "handler_name", kind: "string" },
    { no: 3, name: "parameter", kind: "bytes" },
    { no: 4, name: "invoke_time", kind: "uint64" },
    {
      no: 5,
      name: "headers",
      kind: "message",
      message: HeaderDesc,
      repeated: true,
    },
    { no: 6, name: "key", kind: "string" },
    { no: 7, name: "idempotency_key", kind: "string", presence: true },
    { no: 8, name: "scope", kind: "string", presence: true },
    { no: 9, name: "limit_key", kind: "string", presence: true },
    { no: 10, name: "invocation_id_notification_idx", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface SendSignalCommandMessage {
  target_invocation_id: string;
  idx?: number;
  name?: string;
  void?: Void;
  value?: Value;
  failure?: Failure;
  entry_name: string;
}
export const SendSignalCommandMessageDesc = desc<SendSignalCommandMessage>(
  "SendSignalCommandMessage",
  [
    { no: 1, name: "target_invocation_id", kind: "string" },
    { no: 2, name: "idx", kind: "uint32", presence: true, oneof: "signal_id" },
    { no: 3, name: "name", kind: "string", presence: true, oneof: "signal_id" },
    {
      no: 4,
      name: "void",
      kind: "message",
      message: VoidDesc,
      oneof: "result",
    },
    {
      no: 5,
      name: "value",
      kind: "message",
      message: ValueDesc,
      oneof: "result",
    },
    {
      no: 6,
      name: "failure",
      kind: "message",
      message: FailureDesc,
      oneof: "result",
    },
    { no: 12, name: "entry_name", kind: "string" },
  ]
);

export interface RunCommandMessage {
  result_completion_id: number;
  name: string;
}
export const RunCommandMessageDesc = desc<RunCommandMessage>(
  "RunCommandMessage",
  [
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]
);

export interface AttachInvocationCommandMessage {
  invocation_id?: string;
  idempotent_request_target?: IdempotentRequestTarget;
  workflow_target?: WorkflowTarget;
  result_completion_id: number;
  name: string;
}
export const AttachInvocationCommandMessageDesc =
  desc<AttachInvocationCommandMessage>("AttachInvocationCommandMessage", [
    {
      no: 1,
      name: "invocation_id",
      kind: "string",
      presence: true,
      oneof: "target",
    },
    {
      no: 3,
      name: "idempotent_request_target",
      kind: "message",
      message: IdempotentRequestTargetDesc,
      oneof: "target",
    },
    {
      no: 4,
      name: "workflow_target",
      kind: "message",
      message: WorkflowTargetDesc,
      oneof: "target",
    },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface GetInvocationOutputCommandMessage {
  invocation_id?: string;
  idempotent_request_target?: IdempotentRequestTarget;
  workflow_target?: WorkflowTarget;
  result_completion_id: number;
  name: string;
}
export const GetInvocationOutputCommandMessageDesc =
  desc<GetInvocationOutputCommandMessage>("GetInvocationOutputCommandMessage", [
    {
      no: 1,
      name: "invocation_id",
      kind: "string",
      presence: true,
      oneof: "target",
    },
    {
      no: 3,
      name: "idempotent_request_target",
      kind: "message",
      message: IdempotentRequestTargetDesc,
      oneof: "target",
    },
    {
      no: 4,
      name: "workflow_target",
      kind: "message",
      message: WorkflowTargetDesc,
      oneof: "target",
    },
    { no: 11, name: "result_completion_id", kind: "uint32" },
    { no: 12, name: "name", kind: "string" },
  ]);

export interface CompleteAwakeableCommandMessage {
  awakeable_id: string;
  value?: Value;
  failure?: Failure;
  name: string;
}
export const CompleteAwakeableCommandMessageDesc =
  desc<CompleteAwakeableCommandMessage>("CompleteAwakeableCommandMessage", [
    { no: 1, name: "awakeable_id", kind: "string" },
    {
      no: 2,
      name: "value",
      kind: "message",
      message: ValueDesc,
      oneof: "result",
    },
    {
      no: 3,
      name: "failure",
      kind: "message",
      message: FailureDesc,
      oneof: "result",
    },
    { no: 12, name: "name", kind: "string" },
  ]);

// ---------------------------------------------------------------------------
// Encoding with header
// ---------------------------------------------------------------------------

export function encodeWithHeader<T extends object>(
  ty: MessageType,
  d: MessageDesc<T>,
  msg: T,
  requestedAck?: boolean
): Uint8Array {
  const payload = encodeMessage(d, msg);
  const w = new ProtoWriter(8 + payload.length);
  w.writeRaw(encodeHeader({ ty, length: payload.length, requestedAck }));
  w.writeRaw(payload);
  return w.finish();
}

export function encodeSuspensionMessage(
  msg: SuspensionMessage,
  version: Version
): Uint8Array {
  if (version >= Version.V7) {
    return encodeWithHeader(MessageType.Suspension, SuspensionMessageDesc, msg);
  }
  const old = create(SuspensionMessageV6Desc);
  if (msg.awaiting_on !== undefined) {
    fillWaitingNotificationsRecursive(old, msg.awaiting_on);
  }
  return encodeWithHeader(MessageType.Suspension, SuspensionMessageV6Desc, old);
}

function fillWaitingNotificationsRecursive(
  old: SuspensionMessageV6,
  future: Future
) {
  old.waiting_completions.push(...future.waiting_completions);
  old.waiting_signals.push(...future.waiting_signals);
  old.waiting_named_signals.push(...future.waiting_named_signals);
  for (const nested of future.nested_futures) {
    fillWaitingNotificationsRecursive(old, nested);
  }
}

export function encodeProposeRunCompletionMessage(
  msg: ProposeRunCompletionMessage,
  version: Version
): Uint8Array {
  // The shared core in Protocol V7+ always expects from the runtime a
  // ProposeRunCompletionAck instead of RunCompletionMessage. To enable this
  // behavior in the runtime, we must send `requested_ack`.
  return encodeWithHeader(
    MessageType.ProposeRunCompletion,
    ProposeRunCompletionMessageDesc,
    msg,
    version >= Version.V7 ? true : undefined
  );
}

// ---------------------------------------------------------------------------
// Command definitions: name, header equality and diff for replay checks
// ---------------------------------------------------------------------------

/** Formatter used to render mismatch diffs, mirrors `fmt::DiffFormatter`. */
export class DiffFormatter {
  private out = "";

  constructor(private readonly indentation: string) {}

  writeDiff(fieldName: string, actual: string, expected: string) {
    this.out += `\n${this.indentation}${fieldName}: ${actual} != ${expected}`;
  }

  writeBytesDiff(fieldName: string, actual: Uint8Array, expected: Uint8Array) {
    this.out += `\n${this.indentation}${fieldName}: ${displayBytes(actual)} != ${displayBytes(expected)}`;
  }

  toString(): string {
    return this.out;
  }
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

function tryUtf8(b: Uint8Array): string | undefined {
  try {
    return utf8Strict.decode(b);
  } catch {
    return undefined;
  }
}

function debugBytes(b: Uint8Array): string {
  // Approximation of Rust's `{:?}` for Bytes
  let s = 'b"';
  for (const byte of b) {
    if (byte >= 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x5c) {
      s += String.fromCharCode(byte);
    } else {
      s += "\\x" + byte.toString(16).padStart(2, "0");
    }
  }
  return s + '"';
}

function displayBytes(b: Uint8Array): string {
  const s = tryUtf8(b);
  return s !== undefined ? `'${s}'` : debugBytes(b);
}

export function displayValue(v: Value): string {
  return displayBytes(v.content);
}

export function displayFailure(f: Failure): string {
  return `error [${f.code}] '${f.message}'`;
}

function displayHeader(h: Header): string {
  return `${h.key}: ${h.value}`;
}

function displaySlice<T>(items: T[], f: (t: T) => string): string {
  return items.map(f).join(", ");
}

function displayOptionalString(s: string | undefined): string {
  return s === undefined ? "<empty>" : s;
}

function displayOptionalValue(v: Value | undefined): string {
  return v === undefined ? "<empty>" : displayValue(v);
}

function headersEqual(a: Header[], b: Header[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.key !== b[i]!.key || a[i]!.value !== b[i]!.value) return false;
  }
  return true;
}

function optionalMessageEquals<T extends object>(
  d: MessageDesc<T>,
  a: T | undefined,
  b: T | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return messageEquals(d, a, b);
}

/**
 * Definition of a command message: how to encode/decode it, its name for
 * error reporting, and how to compare it during replay.
 */
export interface CommandMessageDef<T extends object> {
  readonly ty: MessageType;
  readonly desc: MessageDesc<T>;
  name(msg: T): string;
  /**
   * Compare command message headers for equality.
   * `ignorePayloadEquality`: if true, skip payload equality checks
   */
  headerEq(actual: T, expected: T, ignorePayloadEquality: boolean): boolean;
  writeDiff(actual: T, expected: T, f: DiffFormatter): void;
}

function defaultName(msg: { name: string }): string {
  return msg.name;
}

export const InputCommand: CommandMessageDef<InputCommandMessage> = {
  ty: MessageType.InputCommand,
  desc: InputCommandMessageDesc,
  name: defaultName,
  headerEq: () => true,
  writeDiff: () => {},
};

export const OutputCommand: CommandMessageDef<OutputCommandMessage> = {
  ty: MessageType.OutputCommand,
  desc: OutputCommandMessageDesc,
  name: defaultName,
  headerEq(a, b, ignorePayloadEquality) {
    if (ignorePayloadEquality) {
      return (
        a.name === b.name &&
        (a.value !== undefined && b.value !== undefined
          ? true
          : optionalMessageEquals(ValueDesc, a.value, b.value) &&
            optionalMessageEquals(FailureDesc, a.failure, b.failure))
      );
    }
    return messageEquals(OutputCommandMessageDesc, a, b);
  },
  writeDiff(a, b, f) {
    const display = (m: OutputCommandMessage) =>
      m.value !== undefined
        ? displayValue(m.value)
        : m.failure !== undefined
          ? displayFailure(m.failure)
          : "<empty>";
    if (
      !optionalMessageEquals(ValueDesc, a.value, b.value) ||
      !optionalMessageEquals(FailureDesc, a.failure, b.failure)
    ) {
      f.writeDiff("result", display(a), display(b));
    }
  },
};

export const GetLazyStateCommand: CommandMessageDef<GetLazyStateCommandMessage> =
  {
    ty: MessageType.GetLazyStateCommand,
    desc: GetLazyStateCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) => messageEquals(GetLazyStateCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      if (!bytesEqual(a.key, b.key)) {
        f.writeBytesDiff("key", a.key, b.key);
      }
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
    },
  };

export const SetStateCommand: CommandMessageDef<SetStateCommandMessage> = {
  ty: MessageType.SetStateCommand,
  desc: SetStateCommandMessageDesc,
  name: defaultName,
  headerEq(a, b, ignorePayloadEquality) {
    if (ignorePayloadEquality) {
      return (
        a.name === b.name &&
        bytesEqual(a.key, b.key) &&
        (a.value !== undefined && b.value !== undefined
          ? true
          : optionalMessageEquals(ValueDesc, a.value, b.value))
      );
    }
    return messageEquals(SetStateCommandMessageDesc, a, b);
  },
  writeDiff(a, b, f) {
    if (!bytesEqual(a.key, b.key)) {
      f.writeBytesDiff("key", a.key, b.key);
    }
    if (!optionalMessageEquals(ValueDesc, a.value, b.value)) {
      f.writeDiff(
        "value",
        displayOptionalValue(a.value),
        displayOptionalValue(b.value)
      );
    }
  },
};

export const ClearStateCommand: CommandMessageDef<ClearStateCommandMessage> = {
  ty: MessageType.ClearStateCommand,
  desc: ClearStateCommandMessageDesc,
  name: defaultName,
  headerEq: (a, b) => messageEquals(ClearStateCommandMessageDesc, a, b),
  writeDiff(a, b, f) {
    if (!bytesEqual(a.key, b.key)) {
      f.writeBytesDiff("key", a.key, b.key);
    }
  },
};

export const ClearAllStateCommand: CommandMessageDef<ClearAllStateCommandMessage> =
  {
    ty: MessageType.ClearAllStateCommand,
    desc: ClearAllStateCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) => messageEquals(ClearAllStateCommandMessageDesc, a, b),
    writeDiff: () => {},
  };

export const GetLazyStateKeysCommand: CommandMessageDef<GetLazyStateKeysCommandMessage> =
  {
    ty: MessageType.GetLazyStateKeysCommand,
    desc: GetLazyStateKeysCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) => messageEquals(GetLazyStateKeysCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
    },
  };

export const GetEagerStateCommand: CommandMessageDef<GetEagerStateCommandMessage> =
  {
    ty: MessageType.GetEagerStateCommand,
    desc: GetEagerStateCommandMessageDesc,
    name: defaultName,
    headerEq(a, b, ignorePayloadEquality) {
      if (ignorePayloadEquality) {
        return (
          a.name === b.name &&
          bytesEqual(a.key, b.key) &&
          (a.value !== undefined && b.value !== undefined
            ? true
            : optionalMessageEquals(ValueDesc, a.value, b.value) &&
              optionalMessageEquals(VoidDesc, a.void, b.void))
        );
      }
      return messageEquals(GetEagerStateCommandMessageDesc, a, b);
    },
    writeDiff(a, b, f) {
      if (!bytesEqual(a.key, b.key)) {
        f.writeBytesDiff("key", a.key, b.key);
      }
      const display = (m: GetEagerStateCommandMessage) =>
        m.void !== undefined
          ? "void"
          : m.value !== undefined
            ? displayValue(m.value)
            : "<empty>";
      if (
        !optionalMessageEquals(ValueDesc, a.value, b.value) ||
        !optionalMessageEquals(VoidDesc, a.void, b.void)
      ) {
        f.writeDiff("result", display(a), display(b));
      }
    },
  };

export const GetEagerStateKeysCommand: CommandMessageDef<GetEagerStateKeysCommandMessage> =
  {
    ty: MessageType.GetEagerStateKeysCommand,
    desc: GetEagerStateKeysCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) =>
      messageEquals(GetEagerStateKeysCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      const display = (m: GetEagerStateKeysCommandMessage) =>
        m.value === undefined
          ? "<empty>"
          : "[" +
            m.value.keys.map((k) => `'${utf8Decode(k)}'`).join(", ") +
            "]";
      if (!optionalMessageEquals(StateKeysDesc, a.value, b.value)) {
        f.writeDiff("value", display(a), display(b));
      }
    },
  };

export const GetPromiseCommand: CommandMessageDef<GetPromiseCommandMessage> = {
  ty: MessageType.GetPromiseCommand,
  desc: GetPromiseCommandMessageDesc,
  name: defaultName,
  headerEq: (a, b) => messageEquals(GetPromiseCommandMessageDesc, a, b),
  writeDiff(a, b, f) {
    if (a.key !== b.key) {
      f.writeDiff("key", a.key, b.key);
    }
    if (a.result_completion_id !== b.result_completion_id) {
      f.writeDiff(
        "result_completion_id",
        String(a.result_completion_id),
        String(b.result_completion_id)
      );
    }
  },
};

export const PeekPromiseCommand: CommandMessageDef<PeekPromiseCommandMessage> =
  {
    ty: MessageType.PeekPromiseCommand,
    desc: PeekPromiseCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) => messageEquals(PeekPromiseCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      if (a.key !== b.key) {
        f.writeDiff("key", a.key, b.key);
      }
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
    },
  };

export const CompletePromiseCommand: CommandMessageDef<CompletePromiseCommandMessage> =
  {
    ty: MessageType.CompletePromiseCommand,
    desc: CompletePromiseCommandMessageDesc,
    name: defaultName,
    headerEq(a, b, ignorePayloadEquality) {
      if (ignorePayloadEquality) {
        return (
          a.name === b.name &&
          a.key === b.key &&
          a.result_completion_id === b.result_completion_id &&
          (a.completion_value !== undefined && b.completion_value !== undefined
            ? true
            : optionalMessageEquals(
                ValueDesc,
                a.completion_value,
                b.completion_value
              ) &&
              optionalMessageEquals(
                FailureDesc,
                a.completion_failure,
                b.completion_failure
              ))
        );
      }
      return messageEquals(CompletePromiseCommandMessageDesc, a, b);
    },
    writeDiff(a, b, f) {
      if (a.key !== b.key) {
        f.writeDiff("key", a.key, b.key);
      }
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
      const display = (m: CompletePromiseCommandMessage) =>
        m.completion_value !== undefined
          ? displayValue(m.completion_value)
          : m.completion_failure !== undefined
            ? displayFailure(m.completion_failure)
            : "<empty>";
      if (
        !optionalMessageEquals(
          ValueDesc,
          a.completion_value,
          b.completion_value
        ) ||
        !optionalMessageEquals(
          FailureDesc,
          a.completion_failure,
          b.completion_failure
        )
      ) {
        f.writeDiff("completion", display(a), display(b));
      }
    },
  };

export const SleepCommand: CommandMessageDef<SleepCommandMessage> = {
  ty: MessageType.SleepCommand,
  desc: SleepCommandMessageDesc,
  name: defaultName,
  headerEq: (a, b) => a.name === b.name,
  writeDiff(a, b, f) {
    if (a.name !== b.name) {
      f.writeDiff("name", a.name, b.name);
    }
    if (a.result_completion_id !== b.result_completion_id) {
      f.writeDiff(
        "result_completion_id",
        String(a.result_completion_id),
        String(b.result_completion_id)
      );
    }
  },
};

export const CallCommand: CommandMessageDef<CallCommandMessage> = {
  ty: MessageType.CallCommand,
  desc: CallCommandMessageDesc,
  name: defaultName,
  headerEq(a, b, ignorePayloadEquality) {
    return (
      a.service_name === b.service_name &&
      a.handler_name === b.handler_name &&
      (ignorePayloadEquality || bytesEqual(a.parameter, b.parameter)) &&
      headersEqual(a.headers, b.headers) &&
      a.key === b.key &&
      a.idempotency_key === b.idempotency_key &&
      a.scope === b.scope &&
      a.limit_key === b.limit_key &&
      a.invocation_id_notification_idx === b.invocation_id_notification_idx &&
      a.result_completion_id === b.result_completion_id &&
      a.name === b.name
    );
  },
  writeDiff(a, b, f) {
    if (a.service_name !== b.service_name) {
      f.writeDiff("service_name", a.service_name, b.service_name);
    }
    if (a.handler_name !== b.handler_name) {
      f.writeDiff("handler_name", a.handler_name, b.handler_name);
    }
    if (!bytesEqual(a.parameter, b.parameter)) {
      f.writeBytesDiff("parameter", a.parameter, b.parameter);
    }
    if (a.key !== b.key) {
      f.writeDiff("key", a.key, b.key);
    }
    if (!headersEqual(a.headers, b.headers)) {
      f.writeDiff(
        "headers",
        displaySlice(a.headers, displayHeader),
        displaySlice(b.headers, displayHeader)
      );
    }
    if (a.name !== b.name) {
      f.writeDiff("name", a.name, b.name);
    }
    if (a.idempotency_key !== b.idempotency_key) {
      f.writeDiff(
        "idempotency_key",
        displayOptionalString(a.idempotency_key),
        displayOptionalString(b.idempotency_key)
      );
    }
    if (a.scope !== b.scope) {
      f.writeDiff(
        "scope",
        displayOptionalString(a.scope),
        displayOptionalString(b.scope)
      );
    }
    if (a.limit_key !== b.limit_key) {
      f.writeDiff(
        "limit_key",
        displayOptionalString(a.limit_key),
        displayOptionalString(b.limit_key)
      );
    }
    if (a.invocation_id_notification_idx !== b.invocation_id_notification_idx) {
      f.writeDiff(
        "invocation_id_notification_idx",
        String(a.invocation_id_notification_idx),
        String(b.invocation_id_notification_idx)
      );
    }
    if (a.result_completion_id !== b.result_completion_id) {
      f.writeDiff(
        "result_completion_id",
        String(a.result_completion_id),
        String(b.result_completion_id)
      );
    }
  },
};

export const OneWayCallCommand: CommandMessageDef<OneWayCallCommandMessage> = {
  ty: MessageType.OneWayCallCommand,
  desc: OneWayCallCommandMessageDesc,
  name: defaultName,
  headerEq(a, b, ignorePayloadEquality) {
    return (
      a.service_name === b.service_name &&
      a.handler_name === b.handler_name &&
      (ignorePayloadEquality || bytesEqual(a.parameter, b.parameter)) &&
      headersEqual(a.headers, b.headers) &&
      a.key === b.key &&
      a.idempotency_key === b.idempotency_key &&
      a.scope === b.scope &&
      a.limit_key === b.limit_key &&
      a.invocation_id_notification_idx === b.invocation_id_notification_idx &&
      a.name === b.name
    );
  },
  writeDiff(a, b, f) {
    if (a.service_name !== b.service_name) {
      f.writeDiff("service_name", a.service_name, b.service_name);
    }
    if (a.handler_name !== b.handler_name) {
      f.writeDiff("handler_name", a.handler_name, b.handler_name);
    }
    if (!bytesEqual(a.parameter, b.parameter)) {
      f.writeBytesDiff("parameter", a.parameter, b.parameter);
    }
    if (a.key !== b.key) {
      f.writeDiff("key", a.key, b.key);
    }
    if (!headersEqual(a.headers, b.headers)) {
      f.writeDiff(
        "headers",
        displaySlice(a.headers, displayHeader),
        displaySlice(b.headers, displayHeader)
      );
    }
    if (a.name !== b.name) {
      f.writeDiff("name", a.name, b.name);
    }
    if (a.idempotency_key !== b.idempotency_key) {
      f.writeDiff(
        "idempotency_key",
        displayOptionalString(a.idempotency_key),
        displayOptionalString(b.idempotency_key)
      );
    }
    if (a.scope !== b.scope) {
      f.writeDiff(
        "scope",
        displayOptionalString(a.scope),
        displayOptionalString(b.scope)
      );
    }
    if (a.limit_key !== b.limit_key) {
      f.writeDiff(
        "limit_key",
        displayOptionalString(a.limit_key),
        displayOptionalString(b.limit_key)
      );
    }
    if (a.invocation_id_notification_idx !== b.invocation_id_notification_idx) {
      f.writeDiff(
        "invocation_id_notification_idx",
        String(a.invocation_id_notification_idx),
        String(b.invocation_id_notification_idx)
      );
    }
  },
};

export const SendSignalCommand: CommandMessageDef<SendSignalCommandMessage> = {
  ty: MessageType.SendSignalCommand,
  desc: SendSignalCommandMessageDesc,
  name: (m) => m.entry_name,
  headerEq: (a, b) => messageEquals(SendSignalCommandMessageDesc, a, b),
  writeDiff(a, b, f) {
    if (a.target_invocation_id !== b.target_invocation_id) {
      f.writeDiff(
        "target_invocation_id",
        a.target_invocation_id,
        b.target_invocation_id
      );
    }
    const displaySignalId = (m: SendSignalCommandMessage) =>
      m.idx !== undefined
        ? String(m.idx)
        : m.name !== undefined
          ? m.name
          : "<empty>";
    if (a.idx !== b.idx || a.name !== b.name) {
      f.writeDiff("signal_id", displaySignalId(a), displaySignalId(b));
    }
    const displayResult = (m: SendSignalCommandMessage) =>
      m.void !== undefined
        ? "void"
        : m.value !== undefined
          ? displayValue(m.value)
          : m.failure !== undefined
            ? displayFailure(m.failure)
            : "<empty>";
    if (
      !optionalMessageEquals(VoidDesc, a.void, b.void) ||
      !optionalMessageEquals(ValueDesc, a.value, b.value) ||
      !optionalMessageEquals(FailureDesc, a.failure, b.failure)
    ) {
      f.writeDiff("result", displayResult(a), displayResult(b));
    }
  },
};

export const RunCommand: CommandMessageDef<RunCommandMessage> = {
  ty: MessageType.RunCommand,
  desc: RunCommandMessageDesc,
  name: defaultName,
  headerEq: (a, b) => messageEquals(RunCommandMessageDesc, a, b),
  writeDiff(a, b, f) {
    if (a.name !== b.name) {
      f.writeDiff("name", a.name, b.name);
    }
    if (a.result_completion_id !== b.result_completion_id) {
      f.writeDiff(
        "result_completion_id",
        String(a.result_completion_id),
        String(b.result_completion_id)
      );
    }
  },
};

function displayAttachTarget(m: {
  invocation_id?: string;
  idempotent_request_target?: IdempotentRequestTarget;
  workflow_target?: WorkflowTarget;
}): string {
  if (m.invocation_id !== undefined) {
    return m.invocation_id;
  }
  if (m.idempotent_request_target !== undefined) {
    return "IdempotentRequestTarget";
  }
  if (m.workflow_target !== undefined) {
    return "WorkflowTarget";
  }
  return "<empty>";
}

function attachTargetEquals(
  a: {
    invocation_id?: string;
    idempotent_request_target?: IdempotentRequestTarget;
    workflow_target?: WorkflowTarget;
  },
  b: {
    invocation_id?: string;
    idempotent_request_target?: IdempotentRequestTarget;
    workflow_target?: WorkflowTarget;
  }
): boolean {
  return (
    a.invocation_id === b.invocation_id &&
    optionalMessageEquals(
      IdempotentRequestTargetDesc,
      a.idempotent_request_target,
      b.idempotent_request_target
    ) &&
    optionalMessageEquals(
      WorkflowTargetDesc,
      a.workflow_target,
      b.workflow_target
    )
  );
}

export const AttachInvocationCommand: CommandMessageDef<AttachInvocationCommandMessage> =
  {
    ty: MessageType.AttachInvocationCommand,
    desc: AttachInvocationCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) => messageEquals(AttachInvocationCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
      if (!attachTargetEquals(a, b)) {
        f.writeDiff("target", displayAttachTarget(a), displayAttachTarget(b));
      }
    },
  };

export const GetInvocationOutputCommand: CommandMessageDef<GetInvocationOutputCommandMessage> =
  {
    ty: MessageType.GetInvocationOutputCommand,
    desc: GetInvocationOutputCommandMessageDesc,
    name: defaultName,
    headerEq: (a, b) =>
      messageEquals(GetInvocationOutputCommandMessageDesc, a, b),
    writeDiff(a, b, f) {
      if (a.result_completion_id !== b.result_completion_id) {
        f.writeDiff(
          "result_completion_id",
          String(a.result_completion_id),
          String(b.result_completion_id)
        );
      }
      if (!attachTargetEquals(a, b)) {
        f.writeDiff("target", displayAttachTarget(a), displayAttachTarget(b));
      }
    },
  };

export const CompleteAwakeableCommand: CommandMessageDef<CompleteAwakeableCommandMessage> =
  {
    ty: MessageType.CompleteAwakeableCommand,
    desc: CompleteAwakeableCommandMessageDesc,
    name: defaultName,
    headerEq(a, b, ignorePayloadEquality) {
      if (ignorePayloadEquality) {
        return (
          a.name === b.name &&
          a.awakeable_id === b.awakeable_id &&
          (a.value !== undefined && b.value !== undefined
            ? true
            : optionalMessageEquals(ValueDesc, a.value, b.value) &&
              optionalMessageEquals(FailureDesc, a.failure, b.failure))
        );
      }
      return messageEquals(CompleteAwakeableCommandMessageDesc, a, b);
    },
    writeDiff(a, b, f) {
      if (a.awakeable_id !== b.awakeable_id) {
        f.writeDiff("awakeable_id", a.awakeable_id, b.awakeable_id);
      }
      const display = (m: CompleteAwakeableCommandMessage) =>
        m.value !== undefined
          ? displayValue(m.value)
          : m.failure !== undefined
            ? displayFailure(m.failure)
            : "<empty>";
      if (
        !optionalMessageEquals(ValueDesc, a.value, b.value) ||
        !optionalMessageEquals(FailureDesc, a.failure, b.failure)
      ) {
        f.writeDiff("result", display(a), display(b));
      }
    },
  };
