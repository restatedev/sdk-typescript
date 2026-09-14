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
 * Internal data model of the TypeScript shared core, mirrors `lib.rs` and
 * `service_protocol/mod.rs` of the Rust shared core.
 */

import type {
  WasmFailure,
  WasmHeader,
  WasmUnresolvedFuture,
} from "../types.js";
import { WasmCommandType } from "../types.js";
import {
  MessageType,
  messageTypeDebugName,
  type Failure,
  type StateKeys,
  type Value,
  type Void,
} from "./messages.js";

// --- Notification handles and ids

export type NotificationHandle = number;

export const CANCEL_NOTIFICATION_HANDLE: NotificationHandle = 1;

export type CompletionId = number;

export type NotificationId =
  | { readonly type: "completion"; readonly id: CompletionId }
  | { readonly type: "signal"; readonly id: number }
  | { readonly type: "name"; readonly name: string };

export function completionId(id: CompletionId): NotificationId {
  return { type: "completion", id };
}

export function signalId(id: number): NotificationId {
  return { type: "signal", id };
}

export function signalName(name: string): NotificationId {
  return { type: "name", name };
}

/** Stable map key for a notification id. */
export function notificationIdKey(id: NotificationId): string {
  switch (id.type) {
    case "completion":
      return `c:${id.id}`;
    case "signal":
      return `s:${id.id}`;
    case "name":
      return `n:${id.name}`;
  }
}

/** Same as the Rust `Debug` representation of `NotificationId`. */
export function notificationIdDebug(id: NotificationId): string {
  switch (id.type) {
    case "completion":
      return `CompletionId(${id.id})`;
    case "signal":
      return `SignalId(${id.id})`;
    case "name":
      return `SignalName(${JSON.stringify(id.name)})`;
  }
}

export function notificationIdEquals(
  a: NotificationId,
  b: NotificationId
): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === "name") {
    return a.name === (b as { name: string }).name;
  }
  return a.id === (b as { id: number }).id;
}

export type NotificationResult =
  | { readonly type: "void"; readonly void: Void }
  | { readonly type: "value"; readonly value: Value }
  | { readonly type: "failure"; readonly failure: Failure }
  | { readonly type: "invocationId"; readonly invocationId: string }
  | { readonly type: "stateKeys"; readonly stateKeys: StateKeys };

export function isFailureResult(r: NotificationResult): boolean {
  return r.type === "failure";
}

export interface Notification {
  readonly id: NotificationId;
  readonly result: NotificationResult;
}

// --- Public values

/** Same as the `Value` enum in the shared core. */
export type AsyncResultValue =
  | "Empty"
  | { Success: Uint8Array }
  | { Failure: WasmFailure }
  | { StateKeys: string[] }
  | { InvocationId: string };

export type TerminalFailure = WasmFailure;

export function failureToTerminalFailure(f: Failure): TerminalFailure {
  return {
    code: f.code & 0xffff,
    message: f.message,
    metadata: f.metadata.map((m) => ({ key: m.key, value: m.value })),
  };
}

export function terminalFailureToFailure(f: TerminalFailure): Failure {
  return {
    code: f.code,
    message: f.message,
    metadata: f.metadata.map((m) => ({ key: m.key, value: m.value })),
  };
}

const lossyUtf8 = new TextDecoder("utf-8", { fatal: false });

export function notificationResultToValue(
  r: NotificationResult
): AsyncResultValue {
  switch (r.type) {
    case "void":
      return "Empty";
    case "value":
      return { Success: r.value.content };
    case "failure":
      return { Failure: failureToTerminalFailure(r.failure) };
    case "invocationId":
      return { InvocationId: r.invocationId };
    case "stateKeys":
      return { StateKeys: r.stateKeys.keys.map((k) => lossyUtf8.decode(k)) };
  }
}

export type NonEmptyValue =
  | { readonly type: "success"; readonly value: Uint8Array }
  | { readonly type: "failure"; readonly failure: TerminalFailure };

export type RunExitResult =
  | { readonly type: "success"; readonly value: Uint8Array }
  | { readonly type: "terminalFailure"; readonly failure: TerminalFailure }
  | {
      readonly type: "retryableFailure";
      /** millis */
      readonly attemptDuration: number;
      readonly error: import("./errors.js").VMError;
    };

// --- Commands

export { WasmCommandType };
export type CommandType = WasmCommandType;
export const CommandType = WasmCommandType;

export function commandTypeDisplay(ct: CommandType): string {
  switch (ct) {
    case WasmCommandType.Input:
      return "handler input";
    case WasmCommandType.Output:
      return "handler return";
    case WasmCommandType.GetState:
      return "get state";
    case WasmCommandType.GetStateKeys:
      return "get state keys";
    case WasmCommandType.SetState:
      return "set state";
    case WasmCommandType.ClearState:
      return "clear state";
    case WasmCommandType.ClearAllState:
      return "clear all state";
    case WasmCommandType.GetPromise:
      return "get promise";
    case WasmCommandType.PeekPromise:
      return "peek promise";
    case WasmCommandType.CompletePromise:
      return "complete promise";
    case WasmCommandType.Sleep:
      return "sleep";
    case WasmCommandType.Call:
      return "call";
    case WasmCommandType.OneWayCall:
      return "one way call/send";
    case WasmCommandType.SendSignal:
      return "send signal";
    case WasmCommandType.Run:
      return "run";
    case WasmCommandType.AttachInvocation:
      return "attach invocation";
    case WasmCommandType.GetInvocationOutput:
      return "get invocation output";
    case WasmCommandType.CompleteAwakeable:
      return "complete awakeable";
    case WasmCommandType.CancelInvocation:
      return "cancel invocation";
  }
}

export function commandTypeToMessageType(ct: CommandType): MessageType {
  switch (ct) {
    case WasmCommandType.Input:
      return MessageType.InputCommand;
    case WasmCommandType.Output:
      return MessageType.OutputCommand;
    case WasmCommandType.GetState:
      return MessageType.GetLazyStateCommand;
    case WasmCommandType.GetStateKeys:
      return MessageType.GetLazyStateKeysCommand;
    case WasmCommandType.SetState:
      return MessageType.SetStateCommand;
    case WasmCommandType.ClearState:
      return MessageType.ClearStateCommand;
    case WasmCommandType.ClearAllState:
      return MessageType.ClearAllStateCommand;
    case WasmCommandType.GetPromise:
      return MessageType.GetPromiseCommand;
    case WasmCommandType.PeekPromise:
      return MessageType.PeekPromiseCommand;
    case WasmCommandType.CompletePromise:
      return MessageType.CompletePromiseCommand;
    case WasmCommandType.Sleep:
      return MessageType.SleepCommand;
    case WasmCommandType.Call:
      return MessageType.CallCommand;
    case WasmCommandType.OneWayCall:
      return MessageType.OneWayCallCommand;
    case WasmCommandType.SendSignal:
      return MessageType.SendSignalCommand;
    case WasmCommandType.Run:
      return MessageType.RunCommand;
    case WasmCommandType.AttachInvocation:
      return MessageType.AttachInvocationCommand;
    case WasmCommandType.GetInvocationOutput:
      return MessageType.GetInvocationOutputCommand;
    case WasmCommandType.CompleteAwakeable:
      return MessageType.CompleteAwakeableCommand;
    case WasmCommandType.CancelInvocation:
      return MessageType.SendSignalCommand;
  }
}

export function messageTypeToCommandType(
  mt: MessageType
): CommandType | undefined {
  switch (mt) {
    case MessageType.InputCommand:
      return WasmCommandType.Input;
    case MessageType.OutputCommand:
      return WasmCommandType.Output;
    case MessageType.GetLazyStateCommand:
    case MessageType.GetEagerStateCommand:
      return WasmCommandType.GetState;
    case MessageType.GetLazyStateKeysCommand:
    case MessageType.GetEagerStateKeysCommand:
      return WasmCommandType.GetStateKeys;
    case MessageType.SetStateCommand:
      return WasmCommandType.SetState;
    case MessageType.ClearStateCommand:
      return WasmCommandType.ClearState;
    case MessageType.ClearAllStateCommand:
      return WasmCommandType.ClearAllState;
    case MessageType.GetPromiseCommand:
      return WasmCommandType.GetPromise;
    case MessageType.PeekPromiseCommand:
      return WasmCommandType.PeekPromise;
    case MessageType.CompletePromiseCommand:
      return WasmCommandType.CompletePromise;
    case MessageType.SleepCommand:
      return WasmCommandType.Sleep;
    case MessageType.CallCommand:
      return WasmCommandType.Call;
    case MessageType.OneWayCallCommand:
      return WasmCommandType.OneWayCall;
    case MessageType.SendSignalCommand:
      return WasmCommandType.SendSignal;
    case MessageType.RunCommand:
      return WasmCommandType.Run;
    case MessageType.AttachInvocationCommand:
      return WasmCommandType.AttachInvocation;
    case MessageType.GetInvocationOutputCommand:
      return WasmCommandType.GetInvocationOutput;
    case MessageType.CompleteAwakeableCommand:
      return WasmCommandType.CompleteAwakeable;
    default:
      return undefined;
  }
}

/** Same as the Rust `Display` of `MessageType`. */
export function messageTypeDisplay(mt: MessageType): string {
  const ct = messageTypeToCommandType(mt);
  if (ct !== undefined) {
    return commandTypeDisplay(ct);
  }
  return messageTypeDebugName(mt);
}

export type CommandRelationship =
  | { readonly type: "last" }
  | { readonly type: "next"; readonly ty: CommandType; readonly name?: string }
  | {
      readonly type: "specific";
      readonly commandIndex: number;
      readonly ty: CommandType;
      readonly name?: string;
    };

// --- Other data structures

export interface Target {
  service: string;
  handler: string;
  key?: string;
  idempotencyKey?: string;
  scope?: string;
  limitKey?: string;
  headers: WasmHeader[];
}

export interface CallHandle {
  invocationIdNotificationHandle: NotificationHandle;
  callNotificationHandle: NotificationHandle;
}

export interface SendHandle {
  invocationIdNotificationHandle: NotificationHandle;
}

export interface AwakeableHandle {
  id: string;
  handle: NotificationHandle;
}

export interface RunHandle {
  /** If true, the run result will be replayed, meaning the SDK doesn't need to schedule the closure for execution. */
  replayed: boolean;
  handle: NotificationHandle;
}

export interface EntryRetryInfo {
  /** Number of retries that happened so far for this entry. */
  retryCount: number;
  /** Time spent in the current retry loop, in millis. */
  retryLoopDuration: number;
}

export type AttachInvocationTarget =
  | { readonly type: "invocationId"; readonly id: string }
  | {
      readonly type: "workflowId";
      readonly name: string;
      readonly key: string;
      readonly scope?: string;
    }
  | {
      readonly type: "idempotencyId";
      readonly serviceName: string;
      readonly serviceKey?: string;
      readonly handlerName: string;
      readonly idempotencyKey: string;
      readonly scope?: string;
    };

export interface Input {
  invocationId: string;
  randomSeed: bigint;
  key: string;
  headers: WasmHeader[];
  input: Uint8Array;
  scope?: string;
  limitKey?: string;
  idempotencyKey?: string;
}

export interface ResponseHead {
  statusCode: number;
  headers: WasmHeader[];
}

export type UnresolvedFuture = WasmUnresolvedFuture;

export type AwaitResponse =
  | { readonly type: "anyCompleted" }
  | {
      readonly type: "waitingExternalProgress";
      readonly waitingInput: boolean;
      readonly waitingRunProposal: boolean;
    }
  | { readonly type: "executeRun"; readonly handle: NotificationHandle }
  | { readonly type: "cancelSignalReceived" };

export enum VMState {
  WaitingPreFlight = 0,
  Replaying = 1,
  Processing = 2,
  Closed = 3,
}

export enum AwaitingOnPolicy {
  SendAlways,
  DontSendWhenExecutingRun,
  DontSend,
}

export type ImplicitCancellationOption =
  | { readonly type: "disabled" }
  | {
      readonly type: "enabled";
      readonly cancelChildrenCalls: boolean;
      readonly cancelChildrenOneWayCalls: boolean;
    };

export enum NonDeterministicChecksOption {
  /**
   * This will disable checking payloads (state values, rpc request, complete awakeable value),
   * but will still check all the other commands parameters.
   */
  PayloadChecksDisabled,
  Enabled,
}

export enum JournalMismatchRetryBehavior {
  Pause,
  FailTerminally,
  FollowRetryPolicy,
}

export interface VMOptions {
  implicitCancellation: ImplicitCancellationOption;
  nonDeterminismChecks: NonDeterministicChecksOption;
  awaitingOnPolicy: AwaitingOnPolicy;
  journalMismatchRetryBehavior: JournalMismatchRetryBehavior;
}

export function defaultVMOptions(): VMOptions {
  return {
    implicitCancellation: {
      type: "enabled",
      cancelChildrenCalls: true,
      cancelChildrenOneWayCalls: false,
    },
    nonDeterminismChecks: NonDeterministicChecksOption.Enabled,
    awaitingOnPolicy: AwaitingOnPolicy.DontSendWhenExecutingRun,
    journalMismatchRetryBehavior:
      JournalMismatchRetryBehavior.FollowRetryPolicy,
  };
}

export interface PayloadOptions {
  /**
   * If true, skip payload byte equality checks during replay.
   * Use this when the serialization format is non-deterministic.
   */
  unstableSerialization: boolean;
}

export const DEFAULT_PAYLOAD_OPTIONS: PayloadOptions = {
  unstableSerialization: false,
};
