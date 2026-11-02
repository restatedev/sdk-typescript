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

// What the Cloud UI mints: `rstcloudv1_` + base58 over a query string.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function cloudKey(query: string): string {
  const digits: number[] = [];
  for (const byte of new TextEncoder().encode(query)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return `rstcloudv1_${digits
    .reverse()
    .map((d) => BASE58[d]!)
    .join("")}`;
}
const INGRESS_QUERY =
  "envid=env_201k0yd4rz8yftmd4awh1bajg4v&apikey=key_09xyz.2Pq&region=eu.restate.cloud";
const INGRESS_KEY = cloudKey(INGRESS_QUERY);

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
    expect(INGRESS_QUERY).not.toContain("%");
    expect(INGRESS_KEY).toMatch(/^rstcloudv1_[1-9A-HJ-NP-Za-km-z]+$/);

    process.env[INGRESS_KEY_ENV] = "https://not-a-restate-key";
    expect(() => resolveConnectionOpts({})).toThrow(
      /RESTATE_INGRESS_KEY is not a Restate Cloud key \(it does not start with rstcloudv1_\); expected rstcloudv1_<base58> — copy it again from https:\/\/cloud\.restate\.dev/
    );
    process.env[INGRESS_KEY_ENV] = "rstcloudv1_0OIl";
    expect(() => resolveConnectionOpts({})).toThrow(/truncated or corrupted/);
    process.env[INGRESS_KEY_ENV] = "rstcloudv1_5Q"; // a lone 0xff byte
    expect(() => resolveConnectionOpts({})).toThrow(/truncated or corrupted/);
    process.env[INGRESS_KEY_ENV] = cloudKey("a b");
    expect(() => resolveConnectionOpts({})).toThrow(/truncated or corrupted/);
    process.env[INGRESS_KEY_ENV] = cloudKey(
      "envid=env_201k0yd4rz8yftmd4awh1bajg4v&region=eu.restate.cloud"
    );
    expect(() => resolveConnectionOpts({})).toThrow(
      /RESTATE_INGRESS_KEY carries no API key/
    );
    // Same format as the SDK's parser: the environment id and the region are
    // checked, the host is lowercased, the token header-safe, nothing echoed.
    process.env[INGRESS_KEY_ENV] = cloudKey(
      "envid=env_201K0YD4RZ8YFTMD4AWH1BAJG4V&apikey=key_x&region=EU.Restate.Cloud"
    );
    expect(resolveConnectionOpts({}).url).toBe(
      "https://201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud:8080"
    );
    process.env[INGRESS_KEY_ENV] = cloudKey(
      "envid=abc&apikey=key_x&region=eu.restate.cloud"
    );
    expect(() => resolveConnectionOpts({})).toThrow(/incomplete or malformed/);
    process.env[INGRESS_KEY_ENV] = cloudKey("envid=env_abc&apikey=key_x");
    expect(() => resolveConnectionOpts({})).toThrow(/incomplete or malformed/);
    process.env[INGRESS_KEY_ENV] = cloudKey(
      "envid=env_abc&apikey=key_x&region=eu.restate.cloud/x"
    );
    expect(() => resolveConnectionOpts({})).toThrow(/incomplete or malformed/);
    process.env[INGRESS_KEY_ENV] = cloudKey(
      "envid=env_abc&apikey=key%20x&region=eu.restate.cloud"
    );
    expect(() => resolveConnectionOpts({})).toThrow(/HTTP header/);
    process.env[INGRESS_KEY_ENV] = cloudKey(`${INGRESS_QUERY}&apikey=again`);
    expect(() => resolveConnectionOpts({})).toThrow(/it is malformed/);
    process.env[INGRESS_KEY_ENV] = "rstcloudv1_SECRET";
    expect(() => resolveConnectionOpts({})).toThrow(
      /^(?!.*SECRET).*copy it again from https:\/\/cloud\.restate\.dev/
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[INGRESS_KEY_ENV] = cloudKey(
      `${INGRESS_QUERY}&signingkey=publickeyv1_x&future=1`
    );
    const resolved = resolveConnectionOpts({});
    expect(resolved.url).toBe(
      "https://201k0yd4rz8yftmd4awh1bajg4v.env.eu.restate.cloud:8080"
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(
      /does not understand \("signingkey", "future"\)/
    );
  });
});
