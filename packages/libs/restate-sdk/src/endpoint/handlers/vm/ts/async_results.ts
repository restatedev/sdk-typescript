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

/** Mirrors `vm/async_results_state.rs` of the shared core. */

import type { WasmUnresolvedFuture } from "../types.js";
import { badProposeRunCompletionAck } from "./errors.js";
import { CombinatorType, FutureDesc, type Future } from "./messages.js";
import { create } from "./proto.js";
import {
  CANCEL_NOTIFICATION_HANDLE,
  isFailureResult,
  notificationIdEquals,
  notificationIdKey,
  signalId,
  type CompletionId,
  type Notification,
  type NotificationHandle,
  type NotificationId,
  type NotificationResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Future tree
// ---------------------------------------------------------------------------

export type CombinatorKind =
  | "firstCompleted"
  | "allCompleted"
  | "firstSucceededOrAllFailed"
  | "allSucceededOrFirstFailed"
  | "unknown";

/** Mutable tree representation of `UnresolvedFuture`. */
export type FutureNode =
  | { readonly kind: "single"; readonly handle: NotificationHandle }
  | { readonly kind: CombinatorKind; readonly children: FutureNode[] };

export function single(handle: NotificationHandle): FutureNode {
  return { kind: "single", handle };
}

export function fromUnresolvedFuture(f: WasmUnresolvedFuture): FutureNode {
  if ("Single" in f) {
    return single(f.Single);
  }
  if ("FirstCompleted" in f) {
    return {
      kind: "firstCompleted",
      children: f.FirstCompleted.map(fromUnresolvedFuture),
    };
  }
  if ("AllCompleted" in f) {
    return {
      kind: "allCompleted",
      children: f.AllCompleted.map(fromUnresolvedFuture),
    };
  }
  if ("FirstSucceededOrAllFailed" in f) {
    return {
      kind: "firstSucceededOrAllFailed",
      children: f.FirstSucceededOrAllFailed.map(fromUnresolvedFuture),
    };
  }
  if ("AllSucceededOrFirstFailed" in f) {
    return {
      kind: "allSucceededOrFirstFailed",
      children: f.AllSucceededOrFirstFailed.map(fromUnresolvedFuture),
    };
  }
  if ("Unknown" in f) {
    return { kind: "unknown", children: f.Unknown.map(fromUnresolvedFuture) };
  }
  throw new Error(`Unknown unresolved future variant: ${JSON.stringify(f)}`);
}

export function toUnresolvedFuture(n: FutureNode): WasmUnresolvedFuture {
  switch (n.kind) {
    case "single":
      return { Single: n.handle };
    case "firstCompleted":
      return { FirstCompleted: n.children.map(toUnresolvedFuture) };
    case "allCompleted":
      return { AllCompleted: n.children.map(toUnresolvedFuture) };
    case "firstSucceededOrAllFailed":
      return { FirstSucceededOrAllFailed: n.children.map(toUnresolvedFuture) };
    case "allSucceededOrFirstFailed":
      return { AllSucceededOrFirstFailed: n.children.map(toUnresolvedFuture) };
    case "unknown":
      return { Unknown: n.children.map(toUnresolvedFuture) };
  }
}

export function futureHandles(n: FutureNode): NotificationHandle[] {
  const handles: NotificationHandle[] = [];
  const visit = (node: FutureNode) => {
    if (node.kind === "single") {
      handles.push(node.handle);
    } else {
      for (const c of node.children) {
        visit(c);
      }
    }
  };
  visit(n);
  return handles;
}

/** Same as the Rust `Debug` impl of `UnresolvedFuture`. */
export function futureDebug(n: FutureNode): string {
  if (n.kind === "single") {
    return String(n.handle);
  }
  const names: Record<CombinatorKind, string> = {
    firstCompleted: "first_completed",
    allCompleted: "all_completed",
    firstSucceededOrAllFailed: "first_succeeded_or_all_failed",
    allSucceededOrFirstFailed: "all_succeeded_or_first_failed",
    unknown: "unknown",
  };
  return `${names[n.kind]}(${n.children.map(futureDebug).join(", ")})`;
}

// ---------------------------------------------------------------------------
// Async results state
// ---------------------------------------------------------------------------

export type ResolveFutureResult =
  // The shared core has enough information to unblock the SDK, allowing it to take notifications.
  | { readonly type: "anyCompleted" }
  // The shared core needs some external input to make progress on this future.
  | { readonly type: "waitExternalInput"; readonly future: FutureNode };

const enum HandleState {
  Succeeded,
  Failed,
  Pending,
}

function isCompleted(s: HandleState): boolean {
  return s === HandleState.Succeeded || s === HandleState.Failed;
}

interface ReadyEntry {
  id: NotificationId;
  result: NotificationResult;
}

export class AsyncResultsState {
  private toProcess: Notification[] = [];
  private toProcessHead = 0;
  private readonly ready = new Map<string, ReadyEntry>();

  // We cache the results of the run completions executed during this attempt.
  // From protocol >= v7
  private readonly cachedRunCompletions = new Map<
    CompletionId,
    NotificationResult
  >();

  private readonly handleMapping = new Map<
    NotificationHandle,
    NotificationId
  >();
  private nextNotificationHandle: NotificationHandle = 17;

  constructor() {
    // First 15 are reserved for built-in signals!
    this.handleMapping.set(CANCEL_NOTIFICATION_HANDLE, signalId(1));
  }

  enqueue(notification: Notification) {
    this.toProcess.push(notification);
  }

  cacheRunCompletion(
    completionId: CompletionId,
    notificationResult: NotificationResult
  ) {
    this.cachedRunCompletions.set(completionId, notificationResult);
  }

  enqueueRunCompletionAck(completionId: CompletionId) {
    const res = this.cachedRunCompletions.get(completionId);
    if (res === undefined) {
      throw badProposeRunCompletionAck(completionId);
    }
    this.cachedRunCompletions.delete(completionId);
    this.toProcess.push({
      id: { type: "completion", id: completionId },
      result: res,
    });
  }

  insertReady(notification: Notification) {
    this.ready.set(notificationIdKey(notification.id), {
      id: notification.id,
      result: notification.result,
    });
  }

  createHandleMapping(notificationId: NotificationId): NotificationHandle {
    const assignedHandle = this.nextNotificationHandle;
    this.nextNotificationHandle += 1;
    this.handleMapping.set(assignedHandle, notificationId);
    return assignedHandle;
  }

  /**
   * See the extensive comment in the Rust implementation for the theory of
   * future resolution. In short: try to resolve the future against the ready
   * notifications; if it can't be resolved, pop the next notification from the
   * to-process queue and retry; if the queue is empty, external input is needed.
   */
  tryResolveFuture(unresolvedFuture: FutureNode): ResolveFutureResult {
    for (;;) {
      const res = this.tryResolveFutureInner(unresolvedFuture);
      if (res.shortCircuit) {
        // Some of the nested combinator made progress, and shortcircuited the rest of the resolution.
        // We need to give chance to the SDK to consume the new notifications.
        return { type: "anyCompleted" };
      }
      if (isCompleted(res.state)) {
        // Future is completed!
        return { type: "anyCompleted" };
      }
      // If we pop some element from the notification queue, we can try to resolve the future again.
      // Otherwise, the only possible way to make progress now is either reading from input stream, or running a ctx.run if any.
      if (!this.popNotificationQueue()) {
        return { type: "waitExternalInput", future: unresolvedFuture };
      }
    }
  }

  // `shortCircuit` is used to resolve a future, but also "shortcircuit" the reduction process when "one at the time semantics" are required.
  private tryResolveFutureInner(node: FutureNode): {
    shortCircuit: boolean;
    state: HandleState;
  } {
    switch (node.kind) {
      case "single":
        return {
          shortCircuit: false,
          state: this.resolveHandleState(node.handle),
        };
      case "firstCompleted":
      case "unknown": {
        let anyCompleted = false;
        for (const child of node.children) {
          const r = this.tryResolveFutureInner(child);
          if (r.shortCircuit) {
            return r;
          }
          if (isCompleted(r.state)) {
            anyCompleted = true;
            break;
          }
        }
        // Resolve on any child completion (success or failure)
        if (anyCompleted) {
          node.children.length = 0;
          // First completed short-circuits!
          return { shortCircuit: true, state: HandleState.Succeeded };
        }
        return { shortCircuit: false, state: HandleState.Pending };
      }
      case "allCompleted": {
        // Wait for every child to complete
        let i = 0;
        while (i < node.children.length) {
          const r = this.tryResolveFutureInner(node.children[i]!);
          if (r.shortCircuit) {
            return r;
          }
          if (isCompleted(r.state)) {
            swapRemove(node.children, i);
          } else {
            i++;
          }
        }
        return {
          shortCircuit: false,
          state:
            node.children.length === 0
              ? HandleState.Succeeded
              : HandleState.Pending,
        };
      }
      case "firstSucceededOrAllFailed": {
        // First success wins; fail only if all fail
        let i = 0;
        while (i < node.children.length) {
          const r = this.tryResolveFutureInner(node.children[i]!);
          if (r.shortCircuit) {
            return r;
          }
          if (r.state === HandleState.Succeeded) {
            node.children.length = 0;
            return { shortCircuit: true, state: HandleState.Succeeded };
          } else if (r.state === HandleState.Failed) {
            swapRemove(node.children, i);
          } else {
            i++;
          }
        }
        return {
          shortCircuit: false,
          state:
            node.children.length === 0
              ? HandleState.Failed
              : HandleState.Pending,
        };
      }
      case "allSucceededOrFirstFailed": {
        // All must succeed; first failure short-circuits
        let i = 0;
        while (i < node.children.length) {
          const r = this.tryResolveFutureInner(node.children[i]!);
          if (r.shortCircuit) {
            return r;
          }
          if (r.state === HandleState.Failed) {
            node.children.length = 0;
            return { shortCircuit: true, state: HandleState.Failed };
          } else if (r.state === HandleState.Succeeded) {
            swapRemove(node.children, i);
          } else {
            i++;
          }
        }
        return {
          shortCircuit: false,
          state:
            node.children.length === 0
              ? HandleState.Succeeded
              : HandleState.Pending,
        };
      }
    }
  }

  // Returns false if there's no more to_process
  private popNotificationQueue(): boolean {
    if (this.toProcessHead < this.toProcess.length) {
      const notif = this.toProcess[this.toProcessHead]!;
      this.toProcessHead++;
      if (
        this.toProcessHead > 64 &&
        this.toProcessHead * 2 > this.toProcess.length
      ) {
        this.toProcess = this.toProcess.slice(this.toProcessHead);
        this.toProcessHead = 0;
      }
      this.ready.set(notificationIdKey(notif.id), {
        id: notif.id,
        result: notif.result,
      });
      return true;
    }
    return false;
  }

  isHandleCompleted(handle: NotificationHandle): boolean {
    const id = this.handleMapping.get(handle);
    return id !== undefined && this.ready.has(notificationIdKey(id));
  }

  private resolveHandleState(handle: NotificationHandle): HandleState {
    const id = this.handleMapping.get(handle);
    if (id === undefined) {
      return HandleState.Pending;
    }
    const entry = this.ready.get(notificationIdKey(id));
    if (entry === undefined) {
      return HandleState.Pending;
    }
    return isFailureResult(entry.result)
      ? HandleState.Failed
      : HandleState.Succeeded;
  }

  nonDeterministicFindId(id: NotificationId): boolean {
    if (this.ready.has(notificationIdKey(id))) {
      return true;
    }
    for (let i = this.toProcessHead; i < this.toProcess.length; i++) {
      if (notificationIdEquals(this.toProcess[i]!.id, id)) {
        return true;
      }
    }
    return false;
  }

  /** Resolves the given handles to their notification ids (deduplicated). */
  resolveNotificationHandles(
    handles: readonly NotificationHandle[]
  ): NotificationId[] {
    const out = new Map<string, NotificationId>();
    for (const h of handles) {
      const id = this.handleMapping.get(h);
      if (id !== undefined) {
        out.set(notificationIdKey(id), id);
      }
    }
    return [...out.values()];
  }

  /**
   * Convert an unresolved future tree to the wire-format `Future` message.
   *
   * Each variant maps 1:1 to a Future message. `Single` children are inlined
   * into the parent's `waiting_*` fields. All other children (including `Unknown`)
   * become nested `Future` messages.
   */
  resolveUnresolvedFuture(node: FutureNode): Future {
    const future = create(FutureDesc);

    let children: FutureNode[];
    switch (node.kind) {
      case "single":
        future.combinator_type = CombinatorType.FirstCompleted;
        this.pushHandle(future, node.handle);
        return future;
      case "unknown":
        children = node.children;
        break;
      case "firstCompleted":
        future.combinator_type = CombinatorType.FirstCompleted;
        children = node.children;
        break;
      case "allCompleted":
        future.combinator_type = CombinatorType.AllCompleted;
        children = node.children;
        break;
      case "firstSucceededOrAllFailed":
        future.combinator_type = CombinatorType.FirstSucceededOrAllFailed;
        children = node.children;
        break;
      case "allSucceededOrFirstFailed":
        future.combinator_type = CombinatorType.AllSucceededOrFirstFailed;
        children = node.children;
        break;
    }

    for (const child of children) {
      if (child.kind === "single") {
        this.pushHandle(future, child.handle);
      } else {
        future.nested_futures.push(this.resolveUnresolvedFuture(child));
      }
    }
    return future;
  }

  /** Add a handle's notification ID to the appropriate `waiting_*` field. */
  private pushHandle(future: Future, handle: NotificationHandle) {
    const id = this.handleMapping.get(handle);
    if (id === undefined) {
      return;
    }
    switch (id.type) {
      case "completion":
        future.waiting_completions.push(id.id);
        break;
      case "signal":
        future.waiting_signals.push(id.id);
        break;
      case "name":
        future.waiting_named_signals.push(id.name);
        break;
    }
  }

  mustResolveNotificationHandle(handle: NotificationHandle): NotificationId {
    const id = this.handleMapping.get(handle);
    if (id === undefined) {
      throw new Error(
        "If there is an handle, there must be a corresponding id"
      );
    }
    return id;
  }

  takeHandle(handle: NotificationHandle): NotificationResult | undefined {
    const id = this.handleMapping.get(handle);
    if (id === undefined) {
      return undefined;
    }
    const key = notificationIdKey(id);
    const entry = this.ready.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.ready.delete(key);
    if (handle !== CANCEL_NOTIFICATION_HANDLE) {
      // Don't remove the CANCEL handle mapping
      this.handleMapping.delete(handle);
    }
    return entry.result;
  }

  copyHandle(handle: NotificationHandle): NotificationResult | undefined {
    const id = this.handleMapping.get(handle);
    if (id === undefined) {
      return undefined;
    }
    return this.ready.get(notificationIdKey(id))?.result;
  }
}

function swapRemove<T>(arr: T[], i: number) {
  const last = arr.pop()!;
  if (i < arr.length) {
    arr[i] = last;
  }
}
