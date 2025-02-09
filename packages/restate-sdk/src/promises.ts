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

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CombineablePromise } from "./context.js";
import * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import { CancelledError, TimeoutError } from "./types/errors.js";
import { CompletablePromise } from "./utils/completable_promise.js";
import type { ContextImpl, RunClosuresTracker } from "./context_impl.js";
import { setTimeout } from "timers/promises";
import type { InputPump, OutputPump } from "./io.js";

// A promise that is never completed
export function pendingPromise<T>(): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return new Promise<T>(() => {});
}

// ------ Restate promises ------
// These promises are "proxy promises" that will be handed over to the user,
// and moved forward by the PromiseExecutor below when the user awaits on them.

enum PromiseState {
  COMPLETED,
  NOT_COMPLETED,
}

export interface RestatePromise<T> extends CombineablePromise<T> {
  tryCancel(): void;
  tryComplete(): void;
  uncompletedLeaves(): Array<number>;
  publicPromise(): Promise<T>;
}

export type AsyncResultValue =
  | "Empty"
  | { Success: Uint8Array }
  | { Failure: vm.WasmFailure }
  | { StateKeys: string[] }
  | { InvocationId: string };

export const RESTATE_CTX_SYMBOL = Symbol("restateContext");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractContext(n: any): ContextImpl | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return n[RESTATE_CTX_SYMBOL] as ContextImpl | undefined;
}

abstract class AbstractRestatePromise<T> implements RestatePromise<T> {
  [RESTATE_CTX_SYMBOL]: ContextImpl;
  private pollingPromise?: Promise<any>;
  private cancelPromise: CompletablePromise<any> = new CompletablePromise();

  protected constructor(ctx: ContextImpl) {
    this[RESTATE_CTX_SYMBOL] = ctx;
  }

  // --- Promise methods

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined
  ): Promise<TResult1 | TResult2> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(true, this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | null
      | undefined
  ): Promise<T | TResult> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(true, this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<T> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(true, this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().finally(onfinally);
  }

  private publicPromiseOrCancelPromise(): Promise<T> {
    return Promise.race([
      this.cancelPromise.promise as Promise<T>,
      this.publicPromise(),
    ]);
  }

  // --- Combineable Promise methods

  orTimeout(millis: number): CombineablePromise<T> {
    return new RestateCombinatorPromise(
      this[RESTATE_CTX_SYMBOL],
      ([thisPromise, sleepPromise]) => {
        return new Promise((resolve, reject) => {
          thisPromise.then(resolve, reject);
          sleepPromise.then(() => {
            reject(new TimeoutError());
          }, reject);
        });
      },
      [this, this[RESTATE_CTX_SYMBOL].sleep(millis) as RestatePromise<any>]
    ) as CombineablePromise<T>;
  }

  tryCancel() {
    this.cancelPromise.reject(new CancelledError());
  }

  abstract tryComplete(): void;

  abstract uncompletedLeaves(): Array<number>;

  abstract publicPromise(): Promise<T>;

  abstract [Symbol.toStringTag]: string;
}

export class RestateSinglePromise<T> extends AbstractRestatePromise<T> {
  private state: PromiseState = PromiseState.NOT_COMPLETED;
  private completablePromise: CompletablePromise<T> = new CompletablePromise();

  constructor(
    ctx: ContextImpl,
    readonly handle: number,
    private readonly completer: (
      value: AsyncResultValue,
      prom: CompletablePromise<T>
    ) => void
  ) {
    super(ctx);
  }

  uncompletedLeaves(): number[] {
    return this.state === PromiseState.COMPLETED ? [] : [this.handle];
  }

  tryComplete() {
    if (this.state === PromiseState.COMPLETED) {
      return;
    }
    try {
      const notification = this[RESTATE_CTX_SYMBOL].coreVm.take_notification(
        this.handle
      );
      if (notification === "NotReady") {
        return;
      }
      this.state = PromiseState.COMPLETED;
      this.completer(notification, this.completablePromise);
    } catch (e) {
      // This can happen if either take_notification throws an exception or completer throws an exception.
      // Both should be programming mistakes of the SDK, but we cover them here.
      this[RESTATE_CTX_SYMBOL].handleInvocationEndError(e);
    }
  }

  publicPromise(): Promise<T> {
    return this.completablePromise.promise;
  }

  readonly [Symbol.toStringTag] = "RestateSinglePromise";
}

export class RestateCombinatorPromise extends AbstractRestatePromise<any> {
  private state: PromiseState = PromiseState.NOT_COMPLETED;
  private readonly combinatorPromise: Promise<any>;

  constructor(
    ctx: ContextImpl,
    combinatorConstructor: (promises: Promise<any>[]) => Promise<any>,
    readonly childs: Array<RestatePromise<any>>
  ) {
    super(ctx);
    this.combinatorPromise = combinatorConstructor(
      childs.map((p) => p.publicPromise())
    ).finally(() => {
      this.state = PromiseState.COMPLETED;
    });
  }

  uncompletedLeaves(): number[] {
    return this.state === PromiseState.COMPLETED
      ? []
      : this.childs.flatMap((p) => p.uncompletedLeaves());
  }

  tryComplete() {
    this.childs.forEach((c) => c.tryComplete());
  }

  publicPromise(): Promise<unknown> {
    return this.combinatorPromise;
  }

  readonly [Symbol.toStringTag] = "RestateCombinatorPromise";
}

export class RestatePendingPromise<T> implements RestatePromise<T> {
  [RESTATE_CTX_SYMBOL]: ContextImpl;

  constructor(ctx: ContextImpl) {
    this[RESTATE_CTX_SYMBOL] = ctx;
  }

  // --- Promise methods

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined
  ): Promise<TResult1 | TResult2> {
    return pendingPromise<T>().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | null
      | undefined
  ): Promise<T | TResult> {
    return pendingPromise<T>().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<T> {
    return pendingPromise<T>().finally(onfinally);
  }

  // --- RestatePromise methods

  orTimeout(): CombineablePromise<T> {
    return this;
  }

  tryCancel(): void {}
  tryComplete(): void {}
  uncompletedLeaves(): number[] {
    return [];
  }
  publicPromise(): Promise<T> {
    return pendingPromise<T>();
  }

  readonly [Symbol.toStringTag] = "RestatePendingPromise";
}

/**
 * Promises executor, gluing VM with I/O and Promises given to user space.
 */
export class PromisesExecutor {
  private readonly invocationIdsToCancel: Array<RestateSinglePromise<string>> =
    [];

  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly inputPump: InputPump,
    private readonly outputPump: OutputPump,
    private readonly runClosuresTracker: RunClosuresTracker,
    private readonly errorCallback: (e: any) => void
  ) {}

  async doProgress(
    enableImplicitCancellation: boolean,
    restatePromise: RestatePromise<unknown>
  ) {
    // Only the first time try process output
    await this.outputPump.awaitNextProgress();
    await this.doProgressInner(enableImplicitCancellation, restatePromise);
  }

  registerInvocationIdToCancel(p: RestateSinglePromise<string>) {
    this.invocationIdsToCancel.push(p);
  }

  private async doProgressInner(
    enableImplicitCancellation: boolean,
    restatePromise: RestatePromise<unknown>
  ) {
    if (enableImplicitCancellation) {
      const cancellation_notification = this.coreVm.take_notification(
        vm.cancel_handle()
      );
      if (cancellation_notification !== "NotReady") {
        // Cancel child invocations!
        try {
          const invocationIds: string[] = [];
          // Await all the invocation id promises
          for (const invocationId of this.invocationIdsToCancel) {
            // This will not cancel, because I flipped the cancellation by taking it with take_notification
            invocationIds.push(await invocationId);
          }
          // Now cancel all of them boom!
          for (const invocationId of invocationIds) {
            this.coreVm.sys_cancel_invocation(invocationId);
          }
        } catch (e) {
          // Not good
          this.errorCallback(e);
          return;
        }

        // Now flag this promise as cancelled and boom!
        restatePromise.tryCancel();
        return;
      }
    }

    // Try complete the promise
    restatePromise.tryComplete();

    // tl;dr don't touch this, or you can break combineable promises,
    // slinkydeveloper won't be happy about it
    //
    // The reason for this setTimeout is that we need to enqueue the polling after
    // we eventually resolve some promises. This is especially crucial for RestateCombinatorPromise
    // as it flips the completed state using .finally() on the combinator.
    return setTimeout().then(async () => {
      try {
        // Invoke do progress on the vm
        const handles = restatePromise.uncompletedLeaves();
        if (handles.length === 0) {
          // Completed, we're good!
          return;
        }
        if (enableImplicitCancellation) {
          // We want to be woken up on the cancellation marker too!
          handles.push(vm.cancel_handle());
        }
        const doProgressResult = this.coreVm.do_progress(
          new Uint32Array(handles)
        );

        if (doProgressResult === "AnyCompleted") {
          // Next recursion will cause the promise to do some progress
        } else if (doProgressResult === "ReadFromInput") {
          // Read from input
          await this.inputPump.awaitNextProgress();
        } else if (doProgressResult === "WaitingPendingRun") {
          // Wait for any of the pending run to complete
          await this.runClosuresTracker.awaitNextCompletedRun();
        } else {
          // We need to execute a run closure
          this.runClosuresTracker.executeRun(doProgressResult.ExecuteRun);
          // Let the run context switch, then come back to this flow.
          await setTimeout();
        }

        // Recursion
        await this.doProgress(enableImplicitCancellation, restatePromise);
      } catch (e) {
        // Not good, this is a retryable error.
        this.errorCallback(e);
      }
    });
  }
}
