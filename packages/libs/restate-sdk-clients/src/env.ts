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

// Ingress connection from RESTATE_INGRESS_KEY.
//
// `connect()` without a `url` reads `RESTATE_INGRESS_KEY`, an ingress key from
// the Cloud UI (Development → Configure Client). Explicit options always win;
// with neither a `url` nor the variable, `connect()` fails fast, as it always
// required a `url`.
//
// INTERNAL: the key is opaque to users (public docs and errors only say "copy
// it again"). Its format, shared with the SDK's connect key, is
//
//   rstcloudv1_<base58>
//
// where the base58 part (Bitcoin alphabet) encodes the query string
// `envid=env_…&apikey=key_…&region=eu.restate.cloud`. The ingress is
// `https://<envid minus env_>.env.<region>:8080` and the API key is the
// bearer.

import type { ConnectionOpts } from "./api.js";

export const INGRESS_KEY_ENV = "RESTATE_INGRESS_KEY";
/** Where to get an ingress key (Development → Configure Client), linked in every error. */
const INGRESS_KEY_URL =
  "https://cloud.restate.dev/to/developers/integration#configure-client";

const CLOUD_KEY_PREFIX = "rstcloudv1_";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The parameters an ingress key carries; anything else is ignored with a warning. */
const KNOWN_KEY_PARAMS = ["envid", "apikey", "region"];

/** The ingress URL and bearer an ingress key stands for; see the header comment. */
function ingressFromKey(
  value: string,
  what: string = INGRESS_KEY_ENV
): { url: string; token: string } {
  // Reasons never echo parts of the value (the whole thing is a credential)
  // and never describe the encoding: the key is opaque, the fix is a fresh copy.
  const fail = (reason: string): never => {
    throw new Error(
      `${what} is not a Restate Cloud key (${reason}); expected ${CLOUD_KEY_PREFIX}<base58> — copy it again from ${INGRESS_KEY_URL}`
    );
  };
  const corrupted = () => fail("it is truncated or corrupted");
  const trimmed = value.trim();
  if (!trimmed.startsWith(CLOUD_KEY_PREFIX)) {
    return fail(`it does not start with ${CLOUD_KEY_PREFIX}`);
  }
  const encoded = trimmed.slice(CLOUD_KEY_PREFIX.length);
  if (encoded === "") return corrupted();
  let query: string;
  try {
    query = new TextDecoder("utf-8", { fatal: true }).decode(
      base58Decode(encoded)
    );
  } catch {
    return corrupted();
  }
  if (!/^[\x21-\x7e]+$/.test(query)) return corrupted();

  const params = new Map<string, string>();
  const unknown: string[] = [];
  for (const [name, param] of new URLSearchParams(query).entries()) {
    if (name === "") return corrupted();
    if (!KNOWN_KEY_PARAMS.includes(name)) unknown.push(name);
    else if (params.has(name)) return fail("it is malformed");
    else params.set(name, param);
  }
  if (unknown.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `clients.connect(): ${what} carries data this version does not understand (${unknown.map((name) => JSON.stringify(name)).join(", ")}); ignoring it — a newer version may need it`
    );
  }

  const environmentId = params.get("envid");
  const match =
    environmentId === undefined
      ? null
      : /^env_([A-Za-z0-9_-]+)$/.exec(environmentId);
  if (match === null) return fail("it is incomplete or malformed");
  // Hosts are case-insensitive; the UI writes them lowercase.
  const region = params.get("region")?.toLowerCase();
  if (region === undefined || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(region)) {
    return fail("it is incomplete or malformed");
  }
  const token = params.get("apikey");
  if (token === undefined || token === "") {
    throw new Error(
      `${what} carries no API key; copy it again from ${INGRESS_KEY_URL}`
    );
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return fail(
      "the API key contains characters that cannot travel in an HTTP header"
    );
  }
  return {
    url: `https://${match[1]!.toLowerCase()}.env.${region}:8080`,
    token,
  };
}

/** Decode base58 (Bitcoin alphabet); throws on a character outside it. */
function base58Decode(text: string): Uint8Array {
  // Little-endian base-256 digits, multiplied up one base58 digit at a time.
  const digits: number[] = [];
  for (const char of text) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`not base58: ${JSON.stringify(char)}`);
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! * 58;
      digits[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      digits.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading `1` is a leading zero byte.
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const out = new Uint8Array(zeros + digits.length);
  for (let i = 0; i < digits.length; i++) {
    out[zeros + i] = digits[digits.length - 1 - i]!;
  }
  return out;
}

/** Connection options with the ingress URL settled. */
export type ResolvedConnectionOpts = ConnectionOpts & { url: string };

/** Resolve the connection options: the `url` (and bearer) from `RESTATE_INGRESS_KEY` when not given. */
export function resolveConnectionOpts(
  opts: ConnectionOpts
): ResolvedConnectionOpts {
  if (opts.url !== undefined && opts.url !== "") {
    return { ...opts, url: opts.url };
  }
  const value = process.env[INGRESS_KEY_ENV];
  if (value === undefined || value === "") {
    throw new Error(
      `clients.connect(): url is required — pass { url } (e.g. "http://localhost:8080") or set ${INGRESS_KEY_ENV} (create one at ${INGRESS_KEY_URL})`
    );
  }
  const { url, token } = ingressFromKey(value);
  const headers = { ...(opts.headers ?? {}) };
  const hasAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization"
  );
  if (!hasAuthorization) headers["Authorization"] = `Bearer ${token}`;
  return { ...opts, url, headers };
}
