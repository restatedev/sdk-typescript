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

// The Restate Cloud key grammar, shared by `RESTATE_CONNECT_KEY` (the SDK's
// `connect()`) and `RESTATE_INGRESS_KEY` (`clients.connect()`):
//
//   restate://<api key>@<bare environment id>.env.<region domain>/?<params>
//
// URL-shaped on purpose: standard-library parsers everywhere, the secret in
// the userinfo slot that log redactors already mask, and query parameters for
// forward-compatible extras. The host is the environment's own hostname, so
// the environment id (`env_` + first label), the region domain (after
// `.env.`) and the ingress URL (`https://<host>:8080`) all derive from it.

/** A parsed Restate Cloud key, see {@link parseCloudKey}. */
export interface CloudKey {
  /** The API key from the userinfo slot, `undefined` when the key has none. */
  apiKey: string | undefined;
  /** `<bare environment id>.env.<region domain>`: the environment's hostname. */
  host: string;
  /** The environment id, `env_` + the host's first label. */
  environmentId: string;
  /** The part of the host after `.env.` (e.g. `eu.restate.cloud`). */
  regionDomain: string;
  /** The query parameters, in order; the caller decides which ones it knows. */
  params: Array<[name: string, value: string]>;
}

const BARE_ENVIRONMENT_ID = /^[A-Za-z0-9_-]+$/;
const DOMAIN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

/**
 * Parse a Restate Cloud key (`restate://<api key>@<environment id>.env.<region
 * domain>/?…`). Throws an `Error` whose message starts with `what` (the variable
 * or option the value came from) when the string does not follow the grammar;
 * the message says what is wrong and shows the expected shape.
 *
 * @param value the key string
 * @param what how to call the value in errors, e.g. `RESTATE_CONNECT_KEY`
 */
export function parseCloudKey(value: string, what: string): CloudKey {
  const fail = (reason: string): never => {
    throw new Error(
      `${what} is not a Restate Cloud key (${reason}); expected restate://<api key>@<environment id>.env.<region domain>/`
    );
  };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return fail("not a URL");
  }
  if (url.protocol !== "restate:") {
    return fail(
      `the scheme is ${JSON.stringify(url.protocol.replace(/:$/, ""))}, not restate`
    );
  }
  if (url.port !== "") return fail("the host must not carry a port");
  if (url.pathname !== "" && url.pathname !== "/") {
    return fail(`the path must be empty, got ${JSON.stringify(url.pathname)}`);
  }
  if (url.hash !== "") return fail("a fragment is not allowed");

  const host = url.hostname;
  const marker = host.indexOf(".env.");
  const bareEnvironmentId = marker > 0 ? host.slice(0, marker) : "";
  const regionDomain = marker > 0 ? host.slice(marker + ".env.".length) : "";
  if (
    !BARE_ENVIRONMENT_ID.test(bareEnvironmentId) ||
    !DOMAIN.test(regionDomain)
  ) {
    return fail(
      `the host must be <environment id>.env.<region domain>, got ${JSON.stringify(host)}`
    );
  }

  // The userinfo slot: `username[:password]`, percent-decoded. API keys carry
  // no `:` today, but a key is opaque to us, so a password part is re-joined.
  let apiKey: string | undefined;
  if (url.username !== "" || url.password !== "") {
    const raw =
      url.password === "" ? url.username : `${url.username}:${url.password}`;
    try {
      apiKey = decodeURIComponent(raw);
    } catch {
      return fail("the API key is not valid percent-encoding");
    }
  }

  return {
    apiKey,
    host,
    environmentId: `env_${bareEnvironmentId}`,
    regionDomain,
    params: [...url.searchParams.entries()],
  };
}
