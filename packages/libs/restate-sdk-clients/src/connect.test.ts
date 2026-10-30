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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceDefinition } from "@restatedev/restate-sdk-core";
import { connect } from "./ingress.js";
import {
  AUTH_TOKEN_ENV,
  DEFAULT_INGRESS_URL,
  INGRESS_URL_ENV,
  resolveConnectionOpts,
} from "./env.js";

const ENVS = [INGRESS_URL_ENV, AUTH_TOKEN_ENV];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of ENVS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of ENVS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
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

describe("connect() without arguments", () => {
  it("defaults to http://localhost:8080 and no auth; picks up RESTATE_INGRESS_URL and RESTATE_AUTH_TOKEN; explicit options win", async () => {
    const local = recordingFetch();
    await connect({ fetch: local.fetch })
      .serviceClient<Greeter>(greeter)
      .greet("a");
    expect(local.calls[0]!.url).toBe(`${DEFAULT_INGRESS_URL}/Greeter/greet`);
    expect(local.calls[0]!.headers["authorization"]).toBeUndefined();

    process.env[INGRESS_URL_ENV] = "https://abc.env.eu.restate.cloud:8080";
    process.env[AUTH_TOKEN_ENV] = "key_abc.secret";
    const cloud = recordingFetch();
    await connect({ fetch: cloud.fetch })
      .serviceClient<Greeter>(greeter)
      .greet("a");
    expect(cloud.calls[0]!.url).toBe(
      "https://abc.env.eu.restate.cloud:8080/Greeter/greet"
    );
    expect(cloud.calls[0]!.headers["authorization"]).toBe(
      "Bearer key_abc.secret"
    );

    const explicit = resolveConnectionOpts({
      url: "http://ingress.local:8080",
      headers: { authorization: "Bearer mine" },
    });
    expect(explicit.url).toBe("http://ingress.local:8080");
    expect(explicit.headers).toEqual({ authorization: "Bearer mine" });
    // An explicit url still gets the env bearer when no Authorization is set.
    expect(
      resolveConnectionOpts({ url: "http://ingress.local:8080" }).headers
    ).toEqual({ Authorization: "Bearer key_abc.secret" });
  });

  it("reads ./.env from the working directory without overriding the process environment", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-clients-"));
    const cwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(dir, ".env"),
        "RESTATE_INGRESS_URL=https://file.example:8080\nRESTATE_AUTH_TOKEN=key_file\n"
      );
      process.env[AUTH_TOKEN_ENV] = "key_process";
      process.chdir(dir);
      const resolved = resolveConnectionOpts({});
      expect(resolved.url).toBe("https://file.example:8080");
      expect(resolved.headers).toEqual({ Authorization: "Bearer key_process" });
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
