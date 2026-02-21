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

import { describe, expect, it, vi } from "vitest";
import {
  CancellationWatcherPromise,
  RESTATE_CTX_SYMBOL,
} from "../src/promises.js";
import { cancel_handle } from "../src/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";

function createMockCtx(isCompletedFn: (handle: number) => boolean) {
  return {
    coreVm: {
      is_completed: isCompletedFn,
    },
    promisesExecutor: {
      doProgress: () => Promise.resolve(),
    },
  } as any;
}

describe("CancellationWatcherPromise", () => {
  it("tryComplete fires callback when is_completed returns true", async () => {
    const callback = vi.fn();
    let completed = false;
    const ctx = createMockCtx(() => completed);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    await watcher.tryComplete();
    expect(callback).not.toHaveBeenCalled();

    completed = true;
    await watcher.tryComplete();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("tryCancel fires callback and resolves publicPromise", async () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => false);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    watcher.tryCancel();
    expect(callback).toHaveBeenCalledOnce();

    await expect(watcher.publicPromise()).resolves.toBeUndefined();
  });

  it("uncompletedLeaves returns [cancel_handle()] before completion and [] after", async () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => true);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    expect(watcher.uncompletedLeaves()).toEqual([cancel_handle()]);

    await watcher.tryComplete();

    expect(watcher.uncompletedLeaves()).toEqual([]);
  });

  it("callback is only fired once even if tryComplete is called multiple times", async () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => true);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    await watcher.tryComplete();
    await watcher.tryComplete();
    await watcher.tryComplete();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("callback is only fired once even if tryCancel is called multiple times", () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => false);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    watcher.tryCancel();
    watcher.tryCancel();
    watcher.tryCancel();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("tryComplete after tryCancel does not fire callback again", async () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => true);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    watcher.tryCancel();
    expect(callback).toHaveBeenCalledOnce();

    await watcher.tryComplete();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("publicPromise resolves after tryComplete detects completion", async () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => true);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    await watcher.tryComplete();

    await expect(watcher.publicPromise()).resolves.toBeUndefined();
  });

  it("has correct RESTATE_CTX_SYMBOL reference", () => {
    const callback = vi.fn();
    const ctx = createMockCtx(() => false);

    const watcher = new CancellationWatcherPromise(ctx, callback);

    expect(watcher[RESTATE_CTX_SYMBOL]).toBe(ctx);
  });
});
