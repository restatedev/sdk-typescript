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

// Context-local storage e2e: ambient invocation-scoped values against a
// real Restate runtime.
//
// The properties under test that the unit tests can't fully show:
//
//   - A value set before a durable suspension point (`sleep`) is still
//     readable after it. The workflow re-runs from the top on replay and
//     re-`set`s the slot from journaled inputs, so the read is stable —
//     exercised hard by alwaysReplay mode, which replays every entry.
//   - The bag is shared with spawned routines and nested helpers under
//     the same invocation.
//   - It is scoped per invocation: a fresh invocation never sees a value
//     a previous one set (no process-global leak).
//
// Both runtime modes: default + alwaysReplay.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  service,
  gen,
  run,
  sleep,
  spawn,
  contextLocal,
  clients,
  type Operation,
} from "@restatedev/restate-sdk-gen";

// Defined once at module scope — each invocation gets its own bag.
const requestId = contextLocal<string>();
const tenant = contextLocal<string>("public");

// A helper usable both inline (`yield*`) and as a spawned routine. It
// reads the ambient slots — nothing is passed to it.
const auditedStep = (label: string): Operation<string> =>
  gen(function* () {
    return `[${requestId.get()} | ${tenant.get()}] ${label}`;
  });

const ambient = service({
  name: "ambient",
  handlers: {
    // Set context near the top (from a journaled value), cross a
    // suspension point, then read it back from main, a nested helper,
    // and a spawned routine.
    *propagate(input: {
      id: string;
      tenant?: string;
    }): Operation<{ afterSleep: string; nested: string; spawned: string }> {
      requestId.set(
        yield* run(async () => `req-${input.id}`, { name: "reqid" })
      );
      if (input.tenant) tenant.set(input.tenant);

      yield* sleep(1); // durable suspension / replay boundary

      const afterSleep = requestId.get() ?? "LOST";
      const nested = yield* auditedStep("nested");
      const spawned = yield* spawn(auditedStep("spawned"));
      return { afterSleep, nested, spawned };
    },

    // A separate invocation that never sets requestId. Proves the slot
    // is per-invocation: it must read the default, not a value some
    // earlier `propagate` invocation set.
    *whoami(): Operation<string> {
      return requestId.get() ?? "unset";
    },

    // get/set must be called from the generator body, not from inside a
    // `run` action closure (which resolves off the fiber's advance span).
    // Doing so throws "outside an active fiber" — pinned here against the
    // real SDK run path so a slot-lifetime change can't silently let a
    // run closure read/write the bag.
    *runBoundary(): Operation<string> {
      return yield* run(
        async () => {
          try {
            requestId.set("from-run-closure");
            return "DID-NOT-THROW";
          } catch (e) {
            return (e as Error).message.includes("outside an active fiber")
              ? "threw"
              : "WRONG-ERROR";
          }
        },
        { name: "probe" }
      );
    },
  },
});

const modes = [
  { name: "default", alwaysReplay: false },
  { name: "alwaysReplay", alwaysReplay: true },
] as const;

describe.each(modes)("contextLocal — $name mode", ({ alwaysReplay }) => {
  let env: RestateTestEnvironment;
  let ingress: clients.GenIngress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [ambient],
      alwaysReplay,
    });
    ingress = clients.connect({ url: env.baseUrl() });
  });

  afterAll(async () => {
    await env?.stop();
  });

  test("value set before a suspension is readable after, by main / nested / spawned", async () => {
    const client = clients.client(ingress, ambient);
    const out = await client.propagate({ id: "42", tenant: "acme" });
    expect(out.afterSleep).toBe("req-42");
    expect(out.nested).toBe("[req-42 | acme] nested");
    expect(out.spawned).toBe("[req-42 | acme] spawned");
  });

  test("default applies when a slot is left unset within the invocation", async () => {
    const client = clients.client(ingress, ambient);
    const out = await client.propagate({ id: "7" }); // no tenant → default
    expect(out.nested).toBe("[req-7 | public] nested");
  });

  test("scoped per invocation: a fresh invocation does not see a prior one's value", async () => {
    const client = clients.client(ingress, ambient);
    await client.propagate({ id: "999", tenant: "acme" });
    // whoami is a brand-new invocation; it never set requestId.
    expect(await client.whoami()).toBe("unset");
  });

  test("get/set inside a run closure throws (off the advance span)", async () => {
    const client = clients.client(ingress, ambient);
    expect(await client.runBoundary()).toBe("threw");
  });
});
