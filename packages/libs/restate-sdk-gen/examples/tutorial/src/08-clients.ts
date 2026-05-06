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

// Tier 8: calling other handlers (typed clients + awakeables).
//
// Maps to guide.md §"Calling other services".
//
//   client(def)        — typed request/response call into a service
//   client(def, key)   — typed call into a virtual object or workflow
//   sendClient(def)    — fire-and-forget; returns Future<InvocationReference>
//   sendClient(def, key)
//
// Pass the exported definition directly — no shim objects needed.
// `client()` returns ClientFuture<O>: yield* for the result, or
// `.invocation` for the InvocationReference (id, cancel, attach, signal).

import * as restate from "@restatedev/restate-sdk";
import {
  service,
  object,
  schemas,
  awakeable,
  resolveAwakeable,
  client,
  sendClient,
  state,
  sharedState,
} from "@restatedev/restate-sdk-gen";
import { z } from "zod";

// ─── A small "echo" service to call into ───────────────────────────

const RECORDED: { msg: string; at: number }[] = [];

// schemas() — Standard Schema handler. Types are inferred from the Zod
// schema; no annotation needed on the generator parameter.
const GreetReq = z.object({
  name: z.string(),
  locale: z.string().default("en"),
});
const GreetRes = z.object({ greeting: z.string() });

export const greeter = service({
  name: "greeter",
  handlers: {
    *greet(name: string) {
      return `hello, ${name}`;
    },

    // schemas() bundles the Zod schema + generator in one call.
    // req is { name: string; locale: string } — inferred from GreetReq.
    greetLocalized: schemas(
      { input: GreetReq, output: GreetRes },
      function* (req) {
        const prefix = req.locale === "it" ? "ciao" : "hello";
        return { greeting: `${prefix}, ${req.name}` };
      }
    ),

    *record(msg: string) {
      RECORDED.push({ msg, at: Date.now() });
    },
    *recorded() {
      return RECORDED;
    },
  },
});

// ─── Awakeable holder VO ──────────────────────────────────────────

type HolderState = { id: string };

export const awakeableHolder = object({
  name: "awakeableHolder",
  handlers: {
    *hold(id: string) {
      state<HolderState>().set("id", id);
    },
    *completeAwaiter(payload: string) {
      const id = yield* state<HolderState>().get("id");
      if (!id) throw new restate.TerminalError("no awakeable registered yet");
      resolveAwakeable(id, payload);
      state<HolderState>().clear("id");
    },
    *pendingId() {
      return (yield* sharedState<HolderState>().get("id")) ?? null;
    },
  },
  options: {
    handlers: { pendingId: { shared: true } },
  },
});

// ─── Orchestrator ────────────────────────────────────────────────
//
// Uses definitions declared above directly as client handles.
// Forward references are fine: handlers only run after module init.

export const clientsSvc = service({
  name: "clients",
  handlers: {
    // Typed service call — yield* for the result.
    *callGreeter(name: string) {
      return yield* client(greeter).greet(name);
    },

    // Fire-and-forget — don't yield the reference.
    *fireAndForgetRecord(msg: string) {
      sendClient(greeter).record(msg);
    },

    // .invocation — get the InvocationReference without blocking on the
    // result. Useful for cancel, attach, or signal before the call returns.
    *callAndReference(name: string) {
      const f = client(greeter).greet(name);
      const ref = yield* f.invocation;
      const result = yield* f;
      return { invocationId: ref.id, result };
    },

    // Cross-handler coordination via awakeable.
    *awaitExternal() {
      const { id, promise } = awakeable<string>();
      yield* client(awakeableHolder, "demo").hold(id);
      return yield* promise;
    },
  },
});
