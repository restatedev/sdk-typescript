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

// Test-side request-identity signer: mints an Ed25519 keypair in the
// `publickeyv1_<base58>` format and signs v1 identity JWTs the way the
// Restate runtime does (EdDSA; aud = request path; exp/iat/nbf with 60s
// leeway). Lets tests prove the SDK-delegated verification end to end
// without external dependencies.

import * as crypto from "node:crypto";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf: Buffer): string {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

export interface IdentityKey {
  /** The `publickeyv1_...` string to configure as `signingPublicKey`. */
  publicKey: string;
  /** Sign a v1 identity JWT whose audience is `aud` (the request path). */
  sign(aud: string): string;
}

export function generateIdentityKey(): IdentityKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // The publickeyv1 format is base58 over the RAW 32-byte Ed25519 key —
  // the last 32 bytes of the SPKI DER.
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(spki.length - 32);
  const kid = `publickeyv1_${base58Encode(Buffer.from(raw))}`;

  const sign = (aud: string): string => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "EdDSA", typ: "JWT", kid };
    const claims = { aud, nbf: now - 60, iat: now, exp: now + 60 };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = crypto.sign(null, Buffer.from(input), privateKey);
    return `${input}.${b64url(signature)}`;
  };

  return { publicKey: kid, sign };
}
