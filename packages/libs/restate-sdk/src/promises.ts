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

import type {
  RestatePromise,
  InvocationId,
  InvocationPromise,
} from "./context.js";
import type * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import {
  CancelledError,
  RestateError,
  TerminalError,
  TimeoutError,
} from "./types/errors.js";
import { CompletablePromise } from "./utils/completable_promise.js";
import type { ContextImpl, RunClosuresTracker } from "./context_impl.js";
import { setImmediate } from "node:timers/promises";
import type { InputPump, OutputPump } from "./io.js";
import type { Duration } from "@restatedev/restate-sdk-core";

// A promise that is never completed
export function pendingPromise<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

// ------ Restate promises ------
// These promises are "proxy promises" that will be handed over to the user,
// and moved forward by the PromiseExecutor below when the user awaits on them.

/**
 * Returns `true` if the given value is a {@link RestatePromise}.
 *
 * Use this for runtime type detection when you need to distinguish Restate promises
 * from regular promises, e.g. for overload resolution.
 */
export function isRestatePromise<T>(p: Promise<T>): p is RestatePromise<T> {
  return p instanceof InternalRestatePromise;
}

enum PromiseState {
  COMPLETED,
  NOT_COMPLETED,
}

export abstract class InternalRestatePromise<T> implements RestatePromise<T> {
  abstract then<TResult1, TResult2>(
    onfulfilled:
      | ((value: T) => PromiseLike<TResult1> | TResult1)
      | undefined
      | null,
    onrejected:
      | ((reason: any) => PromiseLike<TResult2> | TResult2)
      | undefined
      | null
  ): Promise<TResult1 | TResult2>;
  abstract catch<TResult>(
    onrejected:
      | ((reason: any) => PromiseLike<TResult> | TResult)
      | undefined
      | null
  ): Promise<T | TResult>;
  abstract finally(onfinally: (() => void) | undefined | null): Promise<T>;

  abstract map<U>(
    mapper: (value?: T, failure?: TerminalError) => U
  ): RestatePromise<U>;
  abstract orTimeout(millis: Duration | number): RestatePromise<T>;

  abstract tryCancel(): void;
  abstract tryComplete(): Promise<void>;
  abstract uncompletedLeaves(): Array<number>;
  abstract publicPromise(): Promise<T>;

  abstract readonly [Symbol.toStringTag]: string;
}

export type AsyncResultValue =
  | "Empty"
  | { Success: Uint8Array }
  | { Failure: vm.WasmFailure }
  | { StateKeys: string[] }
  | { InvocationId: string };

const RESTATE_CTX_SYMBOL = Symbol("restateContext");

function extractContext(n: any): ContextImpl | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return n[RESTATE_CTX_SYMBOL] as ContextImpl | undefined;
}

abstract class BaseRestatePromise<T> extends InternalRestatePromise<T> {
  [RESTATE_CTX_SYMBOL]: ContextImpl;
  private pollingPromise?: Promise<any>;
  private cancelPromise: CompletablePromise<any> = new CompletablePromise();

  protected constructor(ctx: ContextImpl) {
    super();
    this[RESTATE_CTX_SYMBOL] = ctx;
  }

  // --- Promise methods

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    this.pollingPromise =
      this.pollingPromise ||
      this[RESTATE_CTX_SYMBOL].promisesExecutor
        .doProgress(this)
        .catch(() => {});
    return this.publicPromiseOrCancelPromise().finally(onfinally);
  }

  private publicPromiseOrCancelPromise(): Promise<T> {
    return Promise.race([
      this.cancelPromise.promise as Promise<T>,
      this.publicPromise(),
    ]);
  }

  // --- RestatePromise methods

  orTimeout(duration: number | Duration): RestatePromise<T> {
    return new CombinatorRestatePromise(
      this[RESTATE_CTX_SYMBOL],
      ([thisPromise, sleepPromise]) => {
        return new Promise((resolve, reject) => {
          thisPromise!.then(resolve, reject);
          sleepPromise!.then(() => {
            reject(new TimeoutError());
          }, reject);
        });
      },
      [
        this,
        this[RESTATE_CTX_SYMBOL].sleep(duration) as InternalRestatePromise<any>,
      ]
    ) as RestatePromise<T>;
  }

  map<U>(mapper: (value?: T, failure?: TerminalError) => U): RestatePromise<U> {
    return new MappedRestatePromise(this[RESTATE_CTX_SYMBOL], this, mapper);
  }

  tryCancel() {
    this.cancelPromise.reject(new CancelledError());
  }

  abstract override tryComplete(): Promise<void>;

  abstract override uncompletedLeaves(): Array<number>;

  abstract override publicPromise(): Promise<T>;

  abstract override [Symbol.toStringTag]: string;
}

export class SingleRestatePromise<T> extends BaseRestatePromise<T> {
  private state: PromiseState = PromiseState.NOT_COMPLETED;
  private completablePromise: CompletablePromise<T> = new CompletablePromise();

  constructor(
    ctx: ContextImpl,
    readonly handle: number,
    private readonly completer: (
      value: AsyncResultValue,
      prom: CompletablePromise<T>
    ) => Promise<void>
  ) {
    super(ctx);
  }

  uncompletedLeaves(): number[] {
    return this.state === PromiseState.COMPLETED ? [] : [this.handle];
  }

  async tryComplete(): Promise<void> {
    if (this.state === PromiseState.COMPLETED) {
      return;
    }
    const notification = this[RESTATE_CTX_SYMBOL].coreVm.take_notification(
      this.handle
    );
    if (notification === "NotReady") {
      return;
    }
    this.state = PromiseState.COMPLETED;
    await this.completer(notification, this.completablePromise);
  }

  publicPromise(): Promise<T> {
    return this.completablePromise.promise;
  }

  isCompleted(): boolean {
    return this.state === PromiseState.COMPLETED;
  }

  readonly [Symbol.toStringTag] = "RestateSinglePromise";
}

export class InvocationRestatePromise<T>
  extends SingleRestatePromise<T>
  implements InvocationPromise<T>
{
  constructor(
    ctx: ContextImpl,
    handle: number,
    completer: (
      value: AsyncResultValue,
      prom: CompletablePromise<T>
    ) => Promise<void>,
    private readonly invocationIdPromise: Promise<InvocationId>
  ) {
    super(ctx, handle, completer);
  }

  get invocationId(): Promise<InvocationId> {
    return this.invocationIdPromise;
  }
}

export class CombinatorRestatePromise extends BaseRestatePromise<any> {
  private state: PromiseState = PromiseState.NOT_COMPLETED;
  private readonly combinatorPromise: Promise<any>;

  constructor(
    ctx: ContextImpl,
    combinatorConstructor: (promises: Promise<any>[]) => Promise<any>,
    readonly childs: Array<InternalRestatePromise<any>>
  ) {
    super(ctx);
    this.combinatorPromise = combinatorConstructor(
      childs.map((p) => p.publicPromise())
    ).finally(() => {
      this.state = PromiseState.COMPLETED;
    });
  }

  // Used by static methods of RestatePromise
  public static fromPromises<T extends readonly RestatePromise<unknown>[]>(
    combinatorConstructor: (promises: Promise<any>[]) => Promise<any>,
    promises: T
  ): RestatePromise<unknown> {
    const castedPromises: InternalRestatePromise<any>[] = [];
    let foundContext: ContextImpl | undefined = undefined;

    for (const [idx, promise] of promises.entries()) {
      if (!isRestatePromise(promise)) {
        throw new Error(
          `Promise index ${idx} used inside the combinator is not an instance of RestatePromise. This is not supported.`
        );
      } else if (foundContext === undefined) {
        foundContext = extractContext(promise);
      } else {
        const thisContext = extractContext(promise);
        if (thisContext !== undefined && thisContext !== foundContext) {
          throw new Error(
            "You're mixing up RestatePromises from different RestateContext. This is not supported."
          );
        }
      }
      castedPromises.push(promise as InternalRestatePromise<any>);
    }

    if (foundContext === undefined) {
      // The only situation where this can happen is when the combined promise contains only ConstRestatePromise as children.
      // In this case, just return back a nice and clean ConstRestatePromise.
      // There is a specific workaround for the funky interface of Promise.race, inside the RestatePromise.race factory method.
      return ConstRestatePromise.fromPromise(
        combinatorConstructor(castedPromises),
        true
      );
    }

    return new CombinatorRestatePromise(
      foundContext,
      combinatorConstructor,
      castedPromises
    );
  }

  uncompletedLeaves(): number[] {
    return this.state === PromiseState.COMPLETED
      ? []
      : this.childs.flatMap((p) => p.uncompletedLeaves());
  }

  async tryComplete(): Promise<void> {
    await Promise.allSettled(this.childs.map((c) => c.tryComplete()));
  }

  publicPromise(): Promise<unknown> {
    return this.combinatorPromise;
  }

  readonly [Symbol.toStringTag] = "RestateCombinatorPromise";
}

export class MappedRestatePromise<T, U> extends BaseRestatePromise<U> {
  private publicPromiseMapper: (
    value?: T,
    failure?: TerminalError
  ) => Promise<U>;

  constructor(
    ctx: ContextImpl,
    readonly inner: InternalRestatePromise<T>,
    mapper: (value?: T, failure?: TerminalError) => U
  ) {
    super(ctx);
    this.publicPromiseMapper = (value?: T, failure?: TerminalError) => {
      try {
        return Promise.resolve(mapper(value, failure));
      } catch (e) {
        if (e instanceof TerminalError) {
          return Promise.reject(e);
        } else {
          ctx.abortAttempt(e);
          return pendingPromise();
        }
      }
    };
  }

  async tryComplete(): Promise<void> {
    await this.inner.tryComplete();
  }

  uncompletedLeaves(): number[] {
    return this.inner.uncompletedLeaves();
  }

  publicPromise(): Promise<U> {
    const promiseMapper = this.publicPromiseMapper;
    return this.inner.publicPromise().then(
      (t) => promiseMapper(t, undefined),
      (error) => {
        if (error instanceof RestateError) {
          return promiseMapper(undefined, error);
        } else {
          // Something else, just re-throw it
          throw error;
        }
      }
    );
  }

  readonly [Symbol.toStringTag] = "RestateMappedPromise";
}

export class ConstRestatePromise<T> extends InternalRestatePromise<T> {
  private constructor(
    private readonly constPromise: Promise<T>,
    private readonly settled: boolean
  ) {
    super();
  }

  static resolve<T>(value: T): ConstRestatePromise<Awaited<T>> {
    return new ConstRestatePromise(Promise.resolve(value), true);
  }

  static reject<T = never>(reason: TerminalError): ConstRestatePromise<T> {
    return new ConstRestatePromise<T>(Promise.reject(reason), true);
  }

  static pending<T>(): ConstRestatePromise<T> {
    return new ConstRestatePromise<T>(pendingPromise(), false);
  }

  static fromPromise<T>(
    promise: Promise<T>,
    settled: boolean
  ): ConstRestatePromise<T> {
    return new ConstRestatePromise(promise, settled);
  }

  // --- Promise methods

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.constPromise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.constPromise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.constPromise.finally(onfinally);
  }

  // --- RestatePromise methods

  orTimeout(): RestatePromise<T> {
    if (this.settled) return this;
    return ConstRestatePromise.reject(new TimeoutError());
  }

  map<U>(mapper: (value?: T, failure?: TerminalError) => U): RestatePromise<U> {
    return ConstRestatePromise.fromPromise(
      this.constPromise.then(
        (value) => mapper(value, undefined),
        (reason) => mapper(undefined, reason as TerminalError)
      ),
      this.settled
    );
  }

  tryCancel() {}

  publicPromise(): Promise<T> {
    return this.constPromise;
  }

  tryComplete(): Promise<void> {
    return Promise.resolve();
  }

  uncompletedLeaves(): Array<number> {
    return [];
  }

  readonly [Symbol.toStringTag] = "ConstRestatePromise";
}

/**
 * Promises executor, gluing VM with I/O and Promises given to user space.
 */
export class PromisesExecutor {
  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly inputPump: InputPump,
    private readonly outputPump: OutputPump,
    private readonly runClosuresTracker: RunClosuresTracker,
    private readonly errorCallback: (e: any) => void
  ) {}

  async doProgress(restatePromise: InternalRestatePromise<unknown>) {
    // Only the first time try process output
    await this.outputPump.awaitNextProgress();
    await this.doProgressInner(restatePromise);
  }

  private async doProgressInner(
    restatePromise: InternalRestatePromise<unknown>
  ) {
    // Try complete the promise
    try {
      await restatePromise.tryComplete();
    } catch (e) {
      // This can happen if either take_notification throws an exception or completer throws an exception.
      // This could either happen for a deserialization issue, or for an SDK bug, but we cover them here.
      this.errorCallback(e);
      return Promise.resolve();
    }

    // tl;dr don't touch this, or you can break combineable promises,
    // slinkydeveloper won't be happy about it
    //
    // The reason for this setTimeout is that we need to enqueue the polling after
    // we eventually resolve some promises. This is especially crucial for RestateCombinatorPromise
    // as it flips the completed state using .finally() on the combinator.
    return setImmediate().then(async () => {
      try {
        // Invoke do progress on the vm
        const handles = restatePromise.uncompletedLeaves();
        if (handles.length === 0) {
          // Completed, we're good!
          return;
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
        } else if (doProgressResult === "CancelSignalReceived") {
          restatePromise.tryCancel();
          return;
        } else {
          // We need to execute a run closure
          this.runClosuresTracker.executeRun(doProgressResult.ExecuteRun);
          // Let the run context switch, then come back to this flow.
          await setImmediate();
        }

        // Recursion
        await this.doProgressInner(restatePromise);
      } catch (e) {
        // Not good, this is a retryable error.
        this.errorCallback(e);
      }
    });
  }
}
