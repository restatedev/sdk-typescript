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

// Tier 13: calling Restate from the outside — the ingress client.
//
// Tiers 1–12 run *inside* Restate (handlers). This tier is the other side:
// a plain Node process that submits invocations to a running endpoint over
// HTTP, using the same typed service definitions.
//
//   clients.connect(opts)          — open an ingress connection
//   clients.client(ing, def)       — typed request/response client
//   clients.client(ing, def, key)  — typed client for an object/workflow key
//   clients.sendClient(ing, def)   — fire-and-forget client
//   clients.Opts.from({ ... })     — per-call options (idempotencyKey, headers, …)
//
// Auto-retry (opt-in): enable it via the connection's `retry` option. The
// client then retries ambiguous failures (network errors, HTTP 429, HTTP 5xx),
// but only when a call carries an `idempotencyKey`. Restate dedupes on the key,
// so a retry safely attaches to the in-flight or completed invocation instead
// of starting a duplicate. Without a key, a retry could double-execute, so none
// is attempted.
//
// Run the endpoint first (`pnpm start:tutorial`), register it with a
// restate-server, then run this module against the ingress URL.

import { clients } from "@restatedev/restate-sdk-gen";
// Reuse the typed `greeter` definition from tier 8 — the same object that
// hosts the handlers also types the ingress client.
import { greeter } from "./08-clients.js";

const INGRESS_URL = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";

export async function runIngressDemo(url: string = INGRESS_URL) {
  // Connect once and reuse. `retry` is a connection-wide, opt-in setting:
  //   - omit it / false → no retries (the default)
  //   - retry: true     → built-in policy (maxAttempts 6, exp. backoff + jitter)
  //   - retry: {...}     → tune the policy, or supply shouldRetry (see below)
  const ingress = clients.connect({
    url,
    retry: {
      maxAttempts: 6,
      initialInterval: { milliseconds: 100 },
      maxInterval: { seconds: 2 },
    },
  });

  const greeterClient = clients.client(ingress, greeter);

  // 1) Idempotent request/response call.
  //    The idempotencyKey both arms auto-retry and makes the invocation
  //    safely repeatable end-to-end — re-running this line with the same key
  //    returns the original result rather than greeting twice.
  const greeting = await greeterClient.greet(
    "sam",
    clients.Opts.from({ idempotencyKey: "greet-sam-once" })
  );
  console.log(greeting); // "hello, sam"

  // 2) Standard-schema handler — input/output typed from the Zod schemas.
  const localized = await greeterClient.greetLocalized(
    { name: "sam", locale: "it" },
    clients.Opts.from({ idempotencyKey: "greet-sam-it" })
  );
  console.log(localized.greeting); // "ciao, sam"

  // 3) No idempotency key → NOT retried on 5xx (retrying could double-run a
  //    non-idempotent handler). Use a key whenever a retry must be safe.
  await greeterClient.greet("anon");

  // 4) Custom retry decision. shouldRetry replaces the built-in rule; compose
  //    with defaultShouldRetry to narrow it — here we keep the defaults but
  //    bail when the response body marks the failure as terminal. The body is
  //    available on response failures when one was present.
  const tuned = clients.connect({
    url,
    retry: {
      shouldRetry: (failure) =>
        clients.defaultShouldRetry(failure) &&
        !(
          failure.kind === "response" && failure.body?.includes("do-not-retry")
        ),
    },
  });
  await clients
    .client(tuned, greeter)
    .greet("bob", clients.Opts.from({ idempotencyKey: "greet-bob" }));

  // 5) Fire-and-forget. `record` returns void; the send resolves once the
  //    invocation is accepted, not when it completes.
  await clients.sendClient(ingress, greeter).record("audit-line");
}

// Run directly: `node dist/13-ingress.js` (or via tsx in dev).
if (import.meta.url === `file://${process.argv[1]}`) {
  runIngressDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
