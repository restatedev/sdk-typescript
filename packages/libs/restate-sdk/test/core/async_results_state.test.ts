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
 * Ported from the unit tests of `vm/async_results_state.rs` in
 * `restate-sdk-shared-core`.
 *
 * These pin down the exact future-resolution semantics, including the order
 * effects of Rust's `Vec::swap_remove` on the futures that remain pending. That
 * order is user-visible: it decides which subtree the SDK is told to consume
 * next, so it must not drift.
 */

import { describe, expect, it } from "vitest";
import {
  AsyncResultsState,
  fromUnresolvedFuture,
  toUnresolvedFuture,
  type FutureNode,
} from "../../src/endpoint/handlers/vm/ts/async_results.js";
import { CombinatorType } from "../../src/endpoint/handlers/vm/ts/messages.js";
import {
  completionId,
  signalId,
  signalName,
  type Notification,
  type NotificationId,
} from "../../src/endpoint/handlers/vm/ts/types.js";
import type { WasmUnresolvedFuture } from "../../src/endpoint/handlers/vm/types.js";

// --- Future builders, using 1-based ids like the Rust tests

type F = WasmUnresolvedFuture | number;
const s = (f: F): WasmUnresolvedFuture =>
  typeof f === "number" ? { Single: f } : f;
const fc = (...c: F[]): WasmUnresolvedFuture => ({ FirstCompleted: c.map(s) });
const ac = (...c: F[]): WasmUnresolvedFuture => ({ AllCompleted: c.map(s) });
const fsaf = (...c: F[]): WasmUnresolvedFuture => ({
  FirstSucceededOrAllFailed: c.map(s),
});
const asff = (...c: F[]): WasmUnresolvedFuture => ({
  AllSucceededOrFirstFailed: c.map(s),
});
const unk = (...c: F[]): WasmUnresolvedFuture => ({ Unknown: c.map(s) });

// --- Helpers mirroring the Rust `success` / `failure` / `state` / `handles`

const success = (id: number): Notification => ({
  id: completionId(id),
  result: { type: "void", void: {} },
});

const failure = (id: number): Notification => ({
  id: completionId(id),
  result: {
    type: "failure",
    failure: { code: 500, message: "fail", metadata: [] },
  },
});

/**
 * Builds a state with ids 1..10 mapped to handles, then enqueues the given
 * notifications. Returns the state plus a translator from the 1-based ids used
 * in the tests to the handles the state actually assigned.
 */
function stateWith(enqueued: Notification[]) {
  const state = new AsyncResultsState();
  const handles = new Map<number, number>();
  for (let i = 1; i <= 10; i++) {
    handles.set(i, state.createHandleMapping(completionId(i)));
  }
  for (const n of enqueued) {
    state.enqueue(n);
  }
  return { state, handles };
}

function handlesWith(mapping: [number, NotificationId][]) {
  const state = new AsyncResultsState();
  const handles = new Map<number, number>();
  for (const [id, notificationId] of mapping) {
    handles.set(id, state.createHandleMapping(notificationId));
  }
  return { state, handles };
}

/** Rewrites the 1-based ids in a future tree into the real handles. */
function translate(
  f: WasmUnresolvedFuture,
  handles: Map<number, number>
): FutureNode {
  const t = (x: WasmUnresolvedFuture): WasmUnresolvedFuture => {
    if ("Single" in x) {
      const h = handles.get(x.Single);
      if (h === undefined) {
        throw new Error(`no handle for id ${x.Single}`);
      }
      return { Single: h };
    }
    if ("FirstCompleted" in x)
      return { FirstCompleted: x.FirstCompleted.map(t) };
    if ("AllCompleted" in x) return { AllCompleted: x.AllCompleted.map(t) };
    if ("FirstSucceededOrAllFailed" in x)
      return { FirstSucceededOrAllFailed: x.FirstSucceededOrAllFailed.map(t) };
    if ("AllSucceededOrFirstFailed" in x)
      return { AllSucceededOrFirstFailed: x.AllSucceededOrFirstFailed.map(t) };
    return { Unknown: x.Unknown.map(t) };
  };
  return fromUnresolvedFuture(t(f));
}

/** `try_resolve_future` returned `AnyCompleted`. */
function expectAnyCompleted(
  enqueued: Notification[],
  input: WasmUnresolvedFuture
) {
  const { state, handles } = stateWith(enqueued);
  const res = state.tryResolveFuture(translate(input, handles));
  expect(res.type).toBe("anyCompleted");
}

/**
 * `try_resolve_future` returned `WaitExternalInput` with exactly this remaining
 * tree. Array order is significant: it is what `swap_remove` left behind.
 */
function expectWaitExternalInput(
  enqueued: Notification[],
  input: WasmUnresolvedFuture,
  expected: WasmUnresolvedFuture
) {
  const { state, handles } = stateWith(enqueued);
  const res = state.tryResolveFuture(translate(input, handles));
  expect(res.type).toBe("waitExternalInput");
  if (res.type !== "waitExternalInput") return;
  expect(toUnresolvedFuture(res.future)).toEqual(
    toUnresolvedFuture(translate(expected, handles))
  );
}

describe("async results state: try resolve future", () => {
  describe("single", () => {
    it("succeeded", () => expectAnyCompleted([success(1)], s(1)));
    it("failed", () => expectAnyCompleted([failure(1)], s(1)));
    it("pending", () => expectWaitExternalInput([], s(1), s(1)));
  });

  describe("first completed", () => {
    it("none ready", () =>
      expectWaitExternalInput([], fc(1, 2, 3), fc(1, 2, 3)));
    it("one succeeded", () => expectAnyCompleted([success(2)], fc(1, 2, 3)));
    // Resolves on any completion, even failure
    it("one failed", () => expectAnyCompleted([failure(1)], fc(1, 2, 3)));
    // first_completed(1, unknown(2)) — unknown(2) completes
    it("with unknown resolves", () =>
      expectAnyCompleted([success(2)], fc(1, unk(2))));
    // first_completed(unknown(all_completed(1, 2)), 3) — completing 3 resolves
    it("unknown wrapping combinator resolves on leaf", () =>
      expectAnyCompleted([success(3)], fc(unk(ac(1, 2)), 3)));
    // Completing 1 alone doesn't resolve: unknown(all_completed(1,2)) needs both
    it("unknown wrapping combinator partial inner", () =>
      expectWaitExternalInput(
        [success(1)],
        fc(unk(ac(1, 2)), 3),
        fc(unk(ac(2)), 3)
      ));
    it("unknown wrapping combinator inner done", () =>
      expectAnyCompleted([success(1), success(2)], fc(unk(ac(1, 2)), 3)));
    // Completing just 1 is NOT enough
    it("deep unknown not prematurely resolved", () =>
      expectWaitExternalInput(
        [success(1)],
        fc(unk(ac(1, unk(2)))),
        fc(unk(ac(unk(2))))
      ));
    it("deep unknown resolves when all done", () =>
      expectAnyCompleted([success(1), success(2)], fc(unk(ac(1, unk(2))))));
  });

  describe("all completed", () => {
    it("none ready", () =>
      expectWaitExternalInput([], ac(1, 2, 3), ac(1, 2, 3)));
    it("partial", () =>
      expectWaitExternalInput([success(1), failure(3)], ac(1, 2, 3), ac(2)));
    it("all done", () =>
      expectAnyCompleted([success(1), failure(2)], ac(1, 2)));
    // Handle 1 completes but unknown(2) still pending
    it("with unknown partial", () =>
      expectWaitExternalInput([success(1)], ac(1, unk(2)), ac(unk(2))));
    it("with unknown all done", () =>
      expectAnyCompleted([success(1), success(2)], ac(1, unk(2))));
  });

  describe("first succeeded or all failed", () => {
    it("none ready", () =>
      expectWaitExternalInput([], fsaf(1, 2, 3), fsaf(1, 2, 3)));
    it("one succeeded", () => expectAnyCompleted([success(2)], fsaf(1, 2, 3)));
    // swap_remove changes order
    it("some failed some pending", () =>
      expectWaitExternalInput([failure(1)], fsaf(1, 2, 3), fsaf(3, 2)));
    it("all failed", () =>
      expectAnyCompleted([failure(1), failure(2)], fsaf(1, 2)));

    it("asff unknown success", () =>
      expectAnyCompleted([success(3)], fsaf(1, asff(2, unk(3)))));
    it("asff unknown failure", () =>
      expectAnyCompleted([failure(3)], fsaf(1, asff(2, unk(3)))));
    // 1 fails → fsaf prunes it, fsaf(2) still pending. 3 still pending.
    it("nested asff partial", () =>
      expectWaitExternalInput(
        [failure(1)],
        fsaf(1, asff(2, unk(3))),
        fsaf(asff(2, unk(3)))
      ));
    // fsaf(1, all_completed(2, unknown(3))) — deep extraction
    it("with nested unknown in all completed", () =>
      expectAnyCompleted([success(3)], fsaf(1, ac(2, unk(3)))));
    it("unknown asff resolves when inner done", () =>
      expectAnyCompleted([success(2), success(3)], fsaf(1, unk(asff(2, 3)))));
    it("unknown asff inner failure resolves", () =>
      expectAnyCompleted([failure(2)], fsaf(1, unk(asff(2, 3)))));
    it("unknown asff inner partial", () =>
      expectWaitExternalInput(
        [success(2)],
        fsaf(1, unk(asff(2, 3))),
        fsaf(1, unk(asff(3)))
      ));
  });

  describe("all succeeded or first failed", () => {
    it("none ready", () =>
      expectWaitExternalInput([], asff(1, 2, 3), asff(1, 2, 3)));
    it("all succeeded", () =>
      expectAnyCompleted([success(1), success(2)], asff(1, 2)));
    it("one failed", () => expectAnyCompleted([failure(2)], asff(1, 2, 3)));
    // swap_remove changes order
    it("some succeeded some pending", () =>
      expectWaitExternalInput([success(1)], asff(1, 2, 3), asff(3, 2)));
    // Inner failure propagates up
    it("promise all short circuits on nested failure", () =>
      expectAnyCompleted([failure(2)], asff(asff(1, 2), 3)));

    // asff(1, unknown(2)) → failure of 2 wakes.
    it("with unknown shortcircuits", () =>
      expectAnyCompleted([failure(2)], asff(1, unk(2))));
    it("unknown fsaf resolves on leaf", () =>
      expectWaitExternalInput(
        [success(1)],
        asff(1, unk(2, fsaf(3, 4))),
        asff(unk(2, fsaf(3, 4)))
      ));
    it("unknown fsaf resolves on inner fsaf success", () =>
      expectAnyCompleted([success(3)], asff(1, unk(2, fsaf(3, 4)))));
    // 3 fails but 4 pending → fsaf pending → nothing AnyCompleted
    it("unknown fsaf failure doesnt resolve", () =>
      expectWaitExternalInput(
        [failure(3)],
        asff(1, unk(2, fsaf(3, 4))),
        asff(1, unk(2, fsaf(4)))
      ));
    // Both 3 and 4 fail → fsaf AnyCompleted → unknown wakes
    it("unknown fsaf all inner fail", () =>
      expectAnyCompleted(
        [failure(3), failure(4)],
        asff(1, unk(2, fsaf(3, 4)))
      ));
    it("unknown fsaf pending", () =>
      expectWaitExternalInput(
        [],
        asff(1, unk(2, fsaf(3, 4))),
        asff(1, unk(2, fsaf(3, 4)))
      ));

    it("unknown all completed with unknown partial 1", () =>
      expectWaitExternalInput(
        [success(1)],
        asff(1, unk(ac(2, unk(3)))),
        asff(unk(ac(2, unk(3))))
      ));
    it("unknown all completed with unknown partial 2", () =>
      expectWaitExternalInput(
        [success(2)],
        asff(1, unk(ac(2, unk(3)))),
        asff(1, unk(ac(unk(3))))
      ));
    it("unknown all completed with unknown shortcircuits failure", () =>
      expectAnyCompleted([failure(1)], asff(1, unk(ac(2, unk(3))))));
    it("unknown all completed with unknown all done", () =>
      expectAnyCompleted(
        [success(2), success(3)],
        asff(1, unk(ac(2, unk(3))))
      ));

    it("with nested first completed", () =>
      expectAnyCompleted([failure(2)], asff(fc(1, 2), fc(3, 4))));

    it("with nested all completed", () =>
      expectWaitExternalInput(
        [failure(1), failure(2)],
        asff(ac(1, 2), ac(3, 4)),
        asff(ac(3, 4))
      ));
    it("with nested all completed only one resolved", () =>
      expectWaitExternalInput(
        [failure(1)],
        asff(ac(1, 2), ac(3, 4)),
        asff(ac(2), ac(3, 4))
      ));
  });

  describe("unknown", () => {
    it("none ready", () => expectWaitExternalInput([], unk(1, 2), unk(1, 2)));
    it("one ready", () => expectAnyCompleted([success(2)], unk(1, 2)));
  });

  describe("nested combinators", () => {
    it("all inside first completed", () =>
      expectAnyCompleted([success(3)], fc(ac(1, 2), 3)));
    it("first completed inside all partial", () =>
      expectAnyCompleted([success(1)], ac(fc(1, 2), fc(3, 4))));
    it("first completed inside all complete", () =>
      expectAnyCompleted([success(1), success(4)], ac(fc(1, 2), fc(3, 4))));
    it("asff inside all partial", () =>
      expectAnyCompleted([failure(1)], ac(asff(1, 2), fc(3, 4))));
    it("fsaf inside all partial", () =>
      expectAnyCompleted([success(1)], ac(fsaf(1, 2), fc(3, 4))));
  });

  describe("duplicated leaves and subtrees", () => {
    it("leaf in all completed", () =>
      expectAnyCompleted([success(1)], ac(1, 1)));
    it("leaf in first completed", () =>
      expectAnyCompleted([success(1)], fc(1, 1, 2)));
    it("leaf failure in promise all", () =>
      expectAnyCompleted([failure(1)], asff(1, 1, 2)));
    it("leaf success in promise any", () =>
      expectAnyCompleted([success(1)], fsaf(1, 1)));
    it("leaf across nested combinators", () =>
      expectAnyCompleted([success(1)], ac(fc(1, 2), fc(1, 3))));
    it("subtree all succeeded", () =>
      expectAnyCompleted([success(1), success(2)], ac(asff(1, 2), asff(1, 2))));
    it("subtree with failure", () =>
      expectAnyCompleted([failure(1)], ac(asff(1, 2), asff(1, 2))));
    it("leaf with unknown in all completed", () =>
      expectAnyCompleted([success(1)], ac(1, unk(1, 2))));
    it("leaf partial resolution", () =>
      expectWaitExternalInput([success(1)], ac(1, 2, 1), ac(2)));
  });
});

describe("async results state: conversion to the protocol future", () => {
  function convert(
    mapping: [number, NotificationId][],
    input: WasmUnresolvedFuture
  ) {
    const { state, handles } = handlesWith(mapping);
    return state.resolveUnresolvedFuture(translate(input, handles));
  }

  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

  it("single completion", () => {
    expect(convert([[1, completionId(1)]], s(1))).toEqual({
      waiting_completions: [1],
      waiting_signals: [],
      waiting_named_signals: [],
      nested_futures: [],
      combinator_type: CombinatorType.FirstCompleted,
    });
  });

  it("single signal", () => {
    expect(convert([[1, signalId(17)]], s(1))).toMatchObject({
      waiting_completions: [],
      waiting_signals: [17],
      waiting_named_signals: [],
      nested_futures: [],
      combinator_type: CombinatorType.FirstCompleted,
    });
  });

  it("single named signal", () => {
    expect(convert([[1, signalName("foo")]], s(1))).toMatchObject({
      waiting_completions: [],
      waiting_signals: [],
      waiting_named_signals: ["foo"],
      nested_futures: [],
      combinator_type: CombinatorType.FirstCompleted,
    });
  });

  // first_completed(1, 2) — both are completions, flattened into waiting_completions
  it("first completed flat", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
      ],
      fc(1, 2)
    );
    expect(sorted(f.waiting_completions)).toEqual([1, 2]);
    expect(f.waiting_signals).toEqual([]);
    expect(f.nested_futures).toEqual([]);
    expect(f.combinator_type).toBe(CombinatorType.FirstCompleted);
  });

  // first_completed(completion, signal) — mixed types flattened
  it("first completed mixed", () => {
    expect(
      convert(
        [
          [1, completionId(1)],
          [2, signalId(5)],
        ],
        fc(1, 2)
      )
    ).toMatchObject({
      waiting_completions: [1],
      waiting_signals: [5],
      waiting_named_signals: [],
      nested_futures: [],
      combinator_type: CombinatorType.FirstCompleted,
    });
  });

  it.each([
    ["all completed", ac(1, 2), CombinatorType.AllCompleted],
    [
      "first succeeded or all failed",
      fsaf(1, 2),
      CombinatorType.FirstSucceededOrAllFailed,
    ],
    [
      "all succeeded or first failed",
      asff(1, 2),
      CombinatorType.AllSucceededOrFirstFailed,
    ],
  ])("%s flat", (_name, input, combinator) => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
      ],
      input
    );
    expect(sorted(f.waiting_completions)).toEqual([1, 2]);
    expect(f.waiting_signals).toEqual([]);
    expect(f.nested_futures).toEqual([]);
    expect(f.combinator_type).toBe(combinator);
  });

  // unknown(1, 2) — Unknown has no combinator_type, children flattened
  it("unknown flat", () => {
    expect(
      convert(
        [
          [1, completionId(1)],
          [2, signalId(5)],
        ],
        unk(1, 2)
      )
    ).toMatchObject({
      waiting_completions: [1],
      waiting_signals: [5],
      nested_futures: [],
      combinator_type: CombinatorType.Unknown,
    });
  });

  // first_completed(1, all_completed(2, 3)) — nested combinator becomes nested Future
  it("nested combinator", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
        [3, completionId(3)],
      ],
      fc(1, ac(2, 3))
    );
    expect(f.waiting_completions).toEqual([1]);
    expect(f.waiting_signals).toEqual([]);
    expect(f.combinator_type).toBe(CombinatorType.FirstCompleted);
    expect(f.nested_futures).toHaveLength(1);
    expect(sorted(f.nested_futures[0]!.waiting_completions)).toEqual([2, 3]);
    expect(f.nested_futures[0]!.nested_futures).toEqual([]);
    expect(f.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );
  });

  // first_completed(unknown(1, 2), 3) — unknown child preserved as nested Future
  it("unknown child nested", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
        [3, completionId(3)],
      ],
      fc(unk(1, 2), 3)
    );
    expect(f.waiting_completions).toEqual([3]);
    expect(f.waiting_signals).toEqual([]);
    expect(f.combinator_type).toBe(CombinatorType.FirstCompleted);
    expect(f.nested_futures).toHaveLength(1);
    expect(sorted(f.nested_futures[0]!.waiting_completions)).toEqual([1, 2]);
    expect(f.nested_futures[0]!.combinator_type).toBe(CombinatorType.Unknown);
  });

  // first_completed(unknown(all_completed(1, 2)), 3) — unknown wrapping combinator:
  // unknown becomes nested Future, all_completed nested inside it
  it("unknown wrapping combinator", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
        [3, completionId(3)],
      ],
      fc(unk(ac(1, 2)), 3)
    );
    expect(f.waiting_completions).toEqual([3]);
    expect(f.combinator_type).toBe(CombinatorType.FirstCompleted);
    expect(f.nested_futures).toHaveLength(1);
    const outerUnknown = f.nested_futures[0]!;
    expect(outerUnknown.waiting_completions).toEqual([]);
    expect(outerUnknown.combinator_type).toBe(CombinatorType.Unknown);
    expect(outerUnknown.nested_futures).toHaveLength(1);
    expect(sorted(outerUnknown.nested_futures[0]!.waiting_completions)).toEqual(
      [1, 2]
    );
    expect(outerUnknown.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );
  });

  // unknown(fsaf(1, 2), 3) — root unknown: fsaf nested, 3 inlined (Single)
  it("unknown root with nested combinator", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, completionId(2)],
        [3, signalId(5)],
      ],
      unk(fsaf(1, 2), 3)
    );
    expect(f.waiting_completions).toEqual([]);
    expect(f.waiting_signals).toEqual([5]);
    expect(f.combinator_type).toBe(CombinatorType.Unknown);
    expect(f.nested_futures).toHaveLength(1);
    expect(sorted(f.nested_futures[0]!.waiting_completions)).toEqual([1, 2]);
    expect(f.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.FirstSucceededOrAllFailed
    );
  });

  // all_completed(1, unknown(2)) — unknown child preserved as nested Future
  it("all completed with unknown child", () => {
    const f = convert(
      [
        [1, completionId(1)],
        [2, signalId(17)],
      ],
      ac(1, unk(2))
    );
    expect(f.waiting_completions).toEqual([1]);
    expect(f.waiting_signals).toEqual([]);
    expect(f.combinator_type).toBe(CombinatorType.AllCompleted);
    expect(f.nested_futures).toHaveLength(1);
    expect(f.nested_futures[0]!.waiting_signals).toEqual([17]);
    expect(f.nested_futures[0]!.combinator_type).toBe(CombinatorType.Unknown);
  });
});
