/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// run() journal-name derivation.
//
// `run(action, opts?)` resolves its journal-entry name in this order:
//   1. opts.name (if non-empty)
//   2. action.name — the function's own .name property
//   3. throw
//
// JS sets .name on:
//   - function declarations:  function foo() {} → "foo"
//   - named function expressions:  (function bar() {}).name → "bar"
//   - assigned arrow:  const baz = () => {}; baz.name → "baz"
//   - method shorthand:  ({ qux() {} }).qux.name → "qux"
//
// Anonymous expressions get .name === "" → run() throws unless opts.name is given.

import { describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import { RestateOperations } from "../src/restate-operations.js";
import { Scheduler } from "../src/scheduler.js";
import { testLib, resolved } from "./test-promise.js";

// Minimal Context stub — only `run` is exercised. We capture the
// journal-entry name and run the action eagerly so the test stays
// synchronous-ish.
function fakeCtx(captured: { name?: string }) {
  return {
    run: (name: string, action: () => Promise<unknown>) => {
      captured.name = name;
      // Return a TestPromise so RestateOperations.toFuture can adapt it.
      return resolved(action());
    },
  } as never;
}

function makeOps(captured: { name?: string }): RestateOperations {
  const sched = new Scheduler(testLib);
  return new RestateOperations(fakeCtx(captured), sched);
}

describe("run name derivation", () => {
  test("explicit opts.name takes precedence over action.name", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    async function namedFn() {
      return 1;
    }
    ops.run(namedFn, { name: "explicit" });
    expect(c.name).toBe("explicit");
  });

  test("named function declaration → name from .name", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    async function fetchUser() {
      return 42;
    }
    ops.run(fetchUser);
    expect(c.name).toBe("fetchUser");
  });

  test("const-bound arrow → name inferred from binding", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    const fetchProfile = async () => 99;
    ops.run(fetchProfile);
    expect(c.name).toBe("fetchProfile");
  });

  test("named function expression → name from expression", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    ops.run(async function chargeCard() {
      return "ok";
    });
    expect(c.name).toBe("chargeCard");
  });

  test("anonymous arrow with no opts → throws TerminalError", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    // TerminalError because a missing name is a programming bug —
    // retrying won't help, and the SDK shouldn't loop on it.
    expect(() => ops.run(async () => "anon")).toThrow(restate.TerminalError);
    expect(() => ops.run(async () => "anon")).toThrow(
      /run\(\) requires a journal-entry name/
    );
  });

  test("anonymous arrow with opts.name → uses opts.name", () => {
    const c: { name?: string } = {};
    const ops = makeOps(c);
    ops.run(async () => "anon", { name: "fallback" });
    expect(c.name).toBe("fallback");
  });
});
