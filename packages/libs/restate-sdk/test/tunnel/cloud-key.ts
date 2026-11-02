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

// Test-side encoder for Restate Cloud keys: what the Cloud UI does, so the
// tests can mint keys for any coordinates. The SDK only decodes.

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
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
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return (
    "1".repeat(zeros) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d]!)
      .join("")
  );
}

/** `rstcloudv1_` + base58 over the given query string. */
export function encodeCloudKeyQuery(query: string): string {
  return `rstcloudv1_${base58Encode(new TextEncoder().encode(query))}`;
}

/** A Restate Cloud key carrying `params` in the given order (undefined values skipped). */
export function cloudKey(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) search.append(name, value);
  }
  return encodeCloudKeyQuery(search.toString());
}

/** The connect key the UI mints for a managed environment. */
export function connectKey(input: {
  environmentId: string;
  apiKey?: string;
  region: string;
  signingKey?: string;
}): string {
  return cloudKey({
    envid: input.environmentId,
    apikey: input.apiKey,
    region: input.region,
    signingkey: input.signingKey,
  });
}
