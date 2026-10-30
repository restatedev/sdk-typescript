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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceDefinition } from "@restatedev/restate-sdk-core";
import { connect } from "./ingress.js";
import { INGRESS_KEY_ENV, resolveConnectionOpts } from "./env.js";

const INGRESS_KEY =
  "restate://key_09xyz.2Pq@201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud/";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[INGRESS_KEY_ENV];
  delete process.env[INGRESS_KEY_ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[INGRESS_KEY_ENV];
  else process.env[INGRESS_KEY_ENV] = saved;
  vi.restoreAllMocks();
});

/** A fetch that records what the client sends and answers a JSON string. */
function recordingFetch() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      headers,
    });
    return Promise.resolve(
      new Response(JSON.stringify("ok"), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  };
  return { calls, fetch };
}

// Handler map of the service under test; the definition only carries the name.
type Greeter = { greet: (context: unknown, name: string) => Promise<string> };
const greeter: ServiceDefinition<"Greeter", Greeter> = { name: "Greeter" };

describe("connect() and RESTATE_INGRESS_KEY", () => {
  it("reads the ingress and bearer from the key; explicit url and Authorization win; nothing set is an error", async () => {
    // Nothing set: a url is required, and the error says where a key comes from.
    expect(() => connect()).toThrow(
      /url is required.*RESTATE_INGRESS_KEY.*cloud\.restate\.dev\/to\/developers\/integration#configure-client/
    );

    process.env[INGRESS_KEY_ENV] = INGRESS_KEY;
    const cloud = recordingFetch();
    await connect({ fetch: cloud.fetch })
      .serviceClient<Greeter>(greeter)
      .greet("a");
    expect(cloud.calls[0]!.url).toBe(
      "https://201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud:8080/Greeter/greet"
    );
    expect(cloud.calls[0]!.headers["authorization"]).toBe(
      "Bearer key_09xyz.2Pq"
    );

    // An explicit Authorization header is kept; other headers are merged.
    expect(
      resolveConnectionOpts({
        headers: { authorization: "Bearer mine", "x-extra": "1" },
      }).headers
    ).toEqual({ authorization: "Bearer mine", "x-extra": "1" });

    // An explicit url is used as given: no key parsing, no bearer injection.
    const explicit = resolveConnectionOpts({ url: "http://localhost:8080" });
    expect(explicit.url).toBe("http://localhost:8080");
    expect(explicit.headers).toBeUndefined();
  });

  it("rejects a malformed key naming the variable, and warns once about unknown parameters", () => {
    process.env[INGRESS_KEY_ENV] = "https://not-a-restate-key";
    expect(() => resolveConnectionOpts({})).toThrow(
      /RESTATE_INGRESS_KEY is not a Restate Cloud key \(the scheme is "https", not restate\)/
    );
    process.env[INGRESS_KEY_ENV] =
      "restate://201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud/";
    expect(() => resolveConnectionOpts({})).toThrow(
      /RESTATE_INGRESS_KEY carries no API key/
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[INGRESS_KEY_ENV] = `${INGRESS_KEY}?future=1&other=2`;
    const resolved = resolveConnectionOpts({});
    expect(resolved.url).toBe(
      "https://201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud:8080"
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/"future", "other"/);
  });
});
