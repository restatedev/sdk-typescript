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

import { expect, it, vi } from "vitest";
import { ContextImpl } from "../src/context_impl.js";
import { SingleRestatePromise } from "../src/promises.js";
import { TerminalError } from "../src/types/errors.js";

it.each([
  { replayed: false, message: "missing", hasLocalCause: true },
  { replayed: true, message: "missing", hasLocalCause: false },
  { replayed: false, message: "replaced failure", hasLocalCause: false },
])(
  "completes with $message (replayed: $replayed, local cause: $hasLocalCause)",
  async ({ replayed, message, hasLocalCause }) => {
    const original = new TerminalError("missing", { errorCode: 404 });
    original.cause = new Error("lookup failed");
    const failure = { code: 404, message: "missing", metadata: [] };
    const registerRunClosure =
      vi.fn<(handle: number, run: () => Promise<void>) => void>();
    const proposeFailure = vi.fn();
    const ctx = {
      coreVm: {
        sys_run: () => ({ handle: 1, replayed }),
        last_command_index: () => 1,
        propose_run_completion_failure: proposeFailure,
        take_notification: () => ({ Failure: { ...failure, message } }),
      },
      runClosuresTracker: { registerRunClosure },
      runInterceptor: (_name: string, next: () => Promise<void>) => next(),
      outputPump: { awaitNextProgress: () => Promise.resolve() },
    };
    const result = ContextImpl.prototype.run.call(
      ctx as unknown as ContextImpl,
      "lookup",
      () => {
        throw original;
      }
    ) as SingleRestatePromise<unknown>;
    if (replayed) {
      expect(registerRunClosure).not.toHaveBeenCalled();
    } else {
      await registerRunClosure.mock.calls[0][1]();
      expect(proposeFailure).toHaveBeenCalledWith(1, failure);
    }
    await result.tryComplete();
    await expect(result.publicPromise()).rejects.toMatchObject({
      code: 404,
      message,
      cause: hasLocalCause ? original : undefined,
    });
  }
);
