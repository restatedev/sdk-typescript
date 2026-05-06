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

// Tier 10: splitting interface from implementation with iface.*.
//
// Define the interface once; implement and call it independently.
// The interface carries only type information — no generator functions.
//
//   iface.object(name, descriptors) — pure interface
//   iface.json<I, O>()              — type params, default JSON serde
//   iface.schemas({ input, output}) — Standard Schema (Zod, TypeBox, …)
//   implement(iface, { handlers, options }) — binds generators to interface

import {
  iface,
  implement,
  client,
  state,
  sharedState,
} from "@restatedev/restate-sdk-gen";
import { z } from "zod";

// ── Interface ──────────────────────────────────────────────────────────────
//
// In a real multi-package setup this lives in a shared package that both
// the server and callers import. No implementation dependency required.

const AddReq = z.object({ delta: z.number(), tag: z.string() });

export const counterIface = iface.object("ifaceCounter", {
  add: iface.schemas({
    input: AddReq,
    output: z.object({ value: z.number() }),
  }),
  get: iface.json<void, number>(),
});

// ── Implementation ─────────────────────────────────────────────────────────

type CounterState = { value: number };

export const counterImpl = implement(counterIface, {
  handlers: {
    // req is { delta: number; tag: string } — inferred from the Zod schema
    *add(req) {
      const s = state<CounterState>();
      const value = ((yield* s.get("value")) ?? 0) + req.delta;
      s.set("value", value);
      return { value };
    },

    *get() {
      return (yield* sharedState<CounterState>().get("value")) ?? 0;
    },
  },
  options: {
    handlers: { get: { shared: true } },
  },
});

// ── Caller ────────────────────────────────────────────────────────────────
//
// Pass the interface directly to client() — no separate type import needed.

export const orchestrator = implement(
  iface.service("ifaceOrchestrator", {
    run: iface.json<string, string>(),
  }),
  {
    handlers: {
      *run(itemId) {
        const { value } = yield* client(counterIface, itemId).add({
          delta: 1,
          tag: "purchase",
        });
        return `item ${itemId} count is now ${value}`;
      },
    },
  }
);

export const ifaceServices = [counterImpl, orchestrator] as const;
