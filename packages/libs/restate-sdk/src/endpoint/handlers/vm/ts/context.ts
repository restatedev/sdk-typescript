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

/** Mirrors `vm/context.rs` of the shared core. */

import type { CommandMetadata } from "./errors.js";
import {
  encodeProposeRunCompletionMessage,
  encodeSuspensionMessage,
  encodeWithHeader,
  isCommandMessageType,
  isNotificationMessageType,
  MessageType,
  type CommandMessageDef,
  type ProposeRunCompletionMessage,
  type SuspensionMessage,
} from "./messages.js";
import { compareUtf8, type MessageDesc } from "./proto.js";
import {
  commandTypeToMessageType,
  type AwaitingOnPolicy,
  type CommandRelationship,
  type EntryRetryInfo,
} from "./types.js";
import type { Version } from "./version.js";

export interface StartInfo {
  id: Uint8Array;
  debugId: string;
  key: string;
  entriesToReplay: number;
  retryCountSinceLastStoredEntry: number;
  /** millis */
  durationSinceLastStoredEntry: bigint;
  randomSeed?: bigint;
  scope?: string;
  limitKey?: string;
  idempotencyKey?: string;
}

export class Journal {
  private commandIndexValue: number | undefined = undefined;
  private notificationIndexValue: number | undefined = undefined;
  // Clever trick for protobuf here
  private completionIndex = 1;
  // 1 to 16 are reserved!
  private signalIndex = 17;
  currentEntryTy: MessageType = MessageType.Start;
  currentEntryName = "";

  transition<M extends object>(def: CommandMessageDef<M>, expected: M) {
    if (isNotificationMessageType(def.ty)) {
      this.notificationIndexValue =
        this.notificationIndexValue === undefined
          ? 0
          : this.notificationIndexValue + 1;
    } else if (isCommandMessageType(def.ty)) {
      this.commandIndexValue =
        this.commandIndexValue === undefined ? 0 : this.commandIndexValue + 1;
    }
    this.currentEntryName = def.name(expected);
    this.currentEntryTy = def.ty;
  }

  commandIndex(): number {
    return this.commandIndexValue ?? -1;
  }

  notificationIndex(): number {
    return this.notificationIndexValue ?? -1;
  }

  nextCompletionNotificationId(): number {
    const next = this.completionIndex;
    this.completionIndex += 1;
    return next;
  }

  nextSignalNotificationId(): number {
    const next = this.signalIndex;
    this.signalIndex += 1;
    return next;
  }

  resolveRelatedCommand(relatedCommand: CommandRelationship): CommandMetadata {
    switch (relatedCommand.type) {
      case "last":
        return {
          index: this.commandIndexValue ?? 0,
          ty: this.currentEntryTy,
          name:
            this.currentEntryName === "" ? undefined : this.currentEntryName,
        };
      case "next":
        return {
          index: (this.commandIndexValue ?? 0) + 1,
          ty: commandTypeToMessageType(relatedCommand.ty),
          name: relatedCommand.name,
        };
      case "specific":
        return {
          index: relatedCommand.commandIndex,
          ty: commandTypeToMessageType(relatedCommand.ty),
          name: relatedCommand.name,
        };
    }
  }

  lastCommandMetadata(): CommandMetadata {
    return this.resolveRelatedCommand({ type: "last" });
  }
}

export class Output {
  private buffer: Uint8Array[] = [];
  private bufferedBytes = 0;
  private isClosed = false;

  constructor(readonly version: Version) {}

  send<T extends object>(ty: MessageType, desc: MessageDesc<T>, msg: T) {
    this.push(encodeWithHeader(ty, desc, msg));
  }

  sendCommand<T extends object>(def: CommandMessageDef<T>, msg: T) {
    this.send(def.ty, def.desc, msg);
  }

  sendSuspension(msg: SuspensionMessage) {
    this.push(encodeSuspensionMessage(msg, this.version));
  }

  sendProposeRunCompletion(msg: ProposeRunCompletionMessage) {
    this.push(encodeProposeRunCompletionMessage(msg, this.version));
  }

  private push(bytes: Uint8Array) {
    if (!this.isClosed) {
      this.buffer.push(bytes);
      this.bufferedBytes += bytes.length;
    }
  }

  sendEof() {
    this.isClosed = true;
  }

  /** Returns all the bytes currently buffered in the output buffer, and clears the buffer. */
  take(): Uint8Array {
    if (this.buffer.length === 0) {
      return new Uint8Array(0);
    }
    if (this.buffer.length === 1) {
      const only = this.buffer[0]!;
      this.buffer = [];
      this.bufferedBytes = 0;
      return only;
    }
    const out = new Uint8Array(this.bufferedBytes);
    let offset = 0;
    for (const chunk of this.buffer) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.buffer = [];
    this.bufferedBytes = 0;
    return out;
  }
}

export type EagerGetState =
  /** Means we don't have sufficient information to establish whether state is there or not, so the VM should interact with the runtime to deal with it. */
  | { readonly type: "unknown" }
  | { readonly type: "empty" }
  | { readonly type: "value"; readonly value: Uint8Array };

export type EagerGetStateKeys =
  | { readonly type: "unknown" }
  | { readonly type: "keys"; readonly keys: string[] };

export class EagerState {
  private isPartial: boolean;
  // undefined means Void, value means value
  private readonly values = new Map<string, Uint8Array | undefined>();

  constructor(isPartial = true, values: [string, Uint8Array][] = []) {
    this.isPartial = isPartial;
    for (const [k, v] of values) {
      this.values.set(k, v);
    }
  }

  get(k: string): EagerGetState {
    if (this.values.has(k)) {
      const v = this.values.get(k);
      return v === undefined ? { type: "empty" } : { type: "value", value: v };
    }
    return this.isPartial ? { type: "unknown" } : { type: "empty" };
  }

  getKeys(): EagerGetStateKeys {
    if (this.isPartial) {
      return { type: "unknown" };
    }
    // Rust sorts `Vec<String>` by UTF-8 bytes. A plain JS sort orders by UTF-16
    // code unit, which disagrees for anything outside the BMP, and these keys
    // are written to the journal.
    const keys = [...this.values.keys()].sort(compareUtf8);
    return { type: "keys", keys };
  }

  set(k: string, v: Uint8Array) {
    this.values.set(k, v);
  }

  clear(k: string) {
    this.values.set(k, undefined);
  }

  clearAll() {
    this.values.clear();
    this.isPartial = false;
  }
}

/** Context of the current invocation. Holds some state across all the different FSM transitions. */
export class Context {
  startInfo: StartInfo | undefined = undefined;
  readonly journal = new Journal();
  inputIsClosed = false;
  readonly output: Output;

  constructor(
    readonly negotiatedProtocolVersion: Version,
    readonly nonDeterministicChecksIgnorePayloadEquality: boolean,
    readonly awaitingOnPolicy: AwaitingOnPolicy
  ) {
    this.output = new Output(negotiatedProtocolVersion);
  }

  expectStartInfo(): StartInfo {
    if (this.startInfo === undefined) {
      throw new Error("state is not WaitingStart");
    }
    return this.startInfo;
  }

  inferEntryRetryInfo(): EntryRetryInfo {
    const startInfo = this.expectStartInfo();
    // This is the first entry we try to commit after replay.
    //  ONLY in this case we re-use the StartInfo!
    const retryCount = startInfo.retryCountSinceLastStoredEntry;
    const retryLoopDuration =
      startInfo.retryCountSinceLastStoredEntry === 0
        ? // When the retry count is == 0, the duration_since_last_stored_entry might not be zero.
          //
          // In fact, in that case the duration is the interval between the previously stored entry and the time to start/resume the invocation.
          // For the sake of entry retries though, we're not interested in that time elapsed, so we 0 it here for simplicity of the downstream consumer (the retry policy).
          0
        : Number(startInfo.durationSinceLastStoredEntry);
    return { retryCount, retryLoopDuration };
  }
}
