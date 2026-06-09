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

// Tier 12: context-local storage — ambient values for the invocation.
//
// Maps to guide.md §"Context-local storage". A `contextLocal()` slot is
// an in-memory bag scoped to the current invocation and shared by every
// fiber under it (the main routine and everything it spawns). Use it to
// carry request-scoped context — a correlation id, a tenant, a logging
// prefix — without threading it as a parameter through every helper.
//
// Note this is NOT durable state: it lives only for the invocation. For
// values that must outlive the invocation, use `state()` (tier 7).

import {
  service,
  gen,
  run,
  spawn,
  contextLocal,
  Operation,
} from "@restatedev/restate-sdk-gen";

// Define the slots once, at module scope — minting a slot touches no
// fiber, so this is safe outside a handler. Each invocation gets its own
// bag keyed by these handles; concurrent invocations never collide.
const requestId = contextLocal<string>(); // optional: string | undefined
const tenant = contextLocal<string>("public"); // with a default

// A deeply-nested step. It wants the request id and tenant for its audit
// line, but nothing passed them down — it reads the ambient slots.
const auditedStep = (label: string): Operation<string> =>
  gen(function* () {
    const line = `[req ${requestId.get()} | tenant ${tenant.get()}] ${label}`;
    return yield* run(async () => line, { name: label });
  });

export const ambient = service({
  name: "ambient",
  handlers: {
    // Resolve the ambient context once near the top, then read it
    // everywhere downstream — in nested helpers and in spawned routines,
    // none of which take it as a parameter.
    *process(order: { id: string; tenant?: string }): Operation<string[]> {
      // Set from a journaled value so it is deterministic across replay.
      requestId.set(yield* run(async () => `r-${order.id}`, { name: "reqid" }));
      if (order.tenant) tenant.set(order.tenant);

      // Nested helpers read the slots directly.
      const validated = yield* auditedStep("validate");
      const persisted = yield* auditedStep("persist");

      // A spawned routine shares the same bag — it sees what main set.
      const notified = yield* spawn(auditedStep("notify"));

      return [validated, persisted, notified];
    },
  },
});
