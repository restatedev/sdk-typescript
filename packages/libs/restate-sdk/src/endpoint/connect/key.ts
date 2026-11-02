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

// The Restate Cloud key format (`RESTATE_CONNECT_KEY`; `RESTATE_INGRESS_KEY`
// in @restatedev/restate-sdk-clients shares it, with its own trimmed parser):
//
//   rstcloudv1_<base58>
//
// The base58 part (Bitcoin alphabet, no padding) encodes a UTF-8 query string
// (`application/x-www-form-urlencoded`), for a connect key
//
//   envid=env_201k…&apikey=key_01abc.5Kd…&region=eu.restate.cloud&signingkey=publickeyv1_…
//
// and for an ingress key the same without `signingkey`. Every value is made
// of unreserved characters, so nothing in it is percent-encoded. One opaque
// word: a double click selects it, every shell and secret store copies it
// intact, and expanding it takes one line anywhere
// (`new URLSearchParams(utf8(base58decode(rest)))`). The caller decides which
// parameters it knows; the only derivations are the tunnel SRV name
// (`tunnel.<region>`) and the ingress URL
// (`https://<envid minus env_>.env.<region>:8080`).

/** The prefix every Restate Cloud key starts with. */
export const CLOUD_KEY_PREFIX = "rstcloudv1_";

/** The shape shown in errors. */
export const CLOUD_KEY_SHAPE = `${CLOUD_KEY_PREFIX}<base58>`;

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Parse a Restate Cloud key (`rstcloudv1_<base58>`) into its query parameters,
 * in order. Throws an `Error` whose message starts with `what` (the variable
 * or option the value came from) when the string does not follow the format;
 * the message says what is wrong, shows the expected shape and links `help`.
 *
 * @param value the key string
 * @param what how to call the value in errors, e.g. `RESTATE_CONNECT_KEY`
 * @param help where to get a fresh key, linked in every error
 */
export function parseCloudKey(
  value: string,
  what: string,
  help: string
): Array<[name: string, value: string]> {
  // Reasons never echo parts of the value: the whole thing is a credential.
  const fail = (reason: string): never => {
    throw new Error(
      `${what} is not a Restate Cloud key (${reason}); expected ${CLOUD_KEY_SHAPE} — copy it again from ${help}`
    );
  };
  const trimmed = value.trim();
  if (!trimmed.startsWith(CLOUD_KEY_PREFIX)) {
    return fail(`it does not start with ${CLOUD_KEY_PREFIX}`);
  }
  const encoded = trimmed.slice(CLOUD_KEY_PREFIX.length);
  if (encoded === "") return fail("nothing follows the prefix");
  let bytes: Uint8Array;
  try {
    bytes = base58Decode(encoded);
  } catch {
    return fail("the part after the prefix is not base58");
  }
  let query: string;
  try {
    query = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("the decoded content is not UTF-8");
  }
  // `URLSearchParams` accepts anything; demand the shape we produce: printable
  // ASCII, non-empty, every entry with a name.
  if (!/^[\x21-\x7e]+$/.test(query)) {
    return fail("the decoded content is not a query string");
  }
  const params = [...new URLSearchParams(query).entries()];
  if (params.some(([name]) => name === "")) {
    return fail("the decoded content is not a query string");
  }
  return params;
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
