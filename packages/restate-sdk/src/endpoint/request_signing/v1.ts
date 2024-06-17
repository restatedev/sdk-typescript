/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { Buffer } from "node:buffer";
import type { ValidateResponse, ValidateSuccess } from "./validate";
import { headerValue } from "./validate";
import type { Key } from "./ed25519";
import { importKey, verify } from "./ed25519";
import base from "./basex";

const JWT_HEADER = "x-restate-jwt-v1";
export const SCHEME_V1 = "v1";

export type KeySetV1 = Map<string, Key>;

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const bs58 = base(BASE58_ALPHABET);

// SubjectPublicKeyInfo SEQUENCE (2 elem)
//   algorithm AlgorithmIdentifier SEQUENCE (1 elem)
//     algorithm OBJECT IDENTIFIER 1.3.101.112 curveEd25519 (EdDSA 25519 signature algorithm)
//   subjectPublicKey BIT STRING (256 bit) <insert 32 bytes after this>
const asn1Prefix = Buffer.from("MCowBQYDK2VwAyEA", "base64");

export function parseKeySetV1(keys: string[]): KeySetV1 {
  const map: KeySetV1 = new Map();
  for (const key of keys) {
    if (!key.startsWith("publickeyv1_")) {
      throw new Error(
        "v1 jwt public keys are expected to start with publickeyv1_"
      );
    }

    const pubBytes = Buffer.from(bs58.decode(key.slice("publickeyv1_".length)));

    if (pubBytes.length != 32) {
      throw new Error(
        "v1 jwt public keys are expected to have 32 bytes of data"
      );
    }

    // NB in the webcrypto case (but not node) the key contains a promise that we will only await during verification
    // and so if this promise is in error state, every verification with that key would fail.
    // however, any 32 byte slice is a valid ed25519 public key, so failure here should only be in the case where webcrypto
    // doesn't support ed25519 at all. and deno and cloudflare workers both support it.
    const publicKey = importKey(key, Buffer.concat([asn1Prefix, pubBytes]));

    map.set(key, publicKey);
  }

  return map;
}

export async function validateV1(
  keySet: KeySetV1,
  path: string,
  headers: { [name: string]: string | string[] | undefined }
): Promise<ValidateResponse> {
  const jwt = headerValue(JWT_HEADER, headers);

  if (!jwt) {
    throw new Error(
      `v1 signature scheme expects the following headers: ${[JWT_HEADER]}`
    );
  }

  try {
    return await jwtVerify(keySet, jwt, path);
  } catch (e) {
    return {
      valid: false,
      scheme: SCHEME_V1,
      error: e,
    };
  }
}

async function jwtVerify(
  keySet: KeySetV1,
  jwt: string,
  expectedAud: string
): Promise<ValidateSuccess> {
  const {
    0: protectedHeader,
    1: payload,
    2: signature,
    length,
  } = jwt.split(".");

  if (length !== 3) {
    throw new Error("Invalid Compact JWS; expected 3 parts");
  }

  let header: Record<string, string | undefined> = {};
  try {
    header = JSON.parse(
      Buffer.from(protectedHeader, "base64url").toString()
    ) as Record<string, string | undefined>;
  } catch (e) {
    throw new Error("JWT header is invalid");
  }

  const { typ, alg, kid } = header;

  if (typ != "JWT") {
    throw new Error('JWT must have "typ" header "JWT"');
  }

  if (alg != "EdDSA") {
    throw new Error('JWT must have "alg" header "EdDSA"');
  }

  if (typeof kid !== "string" || !alg) {
    throw new Error('JWT must have "kid" header, which must be a string');
  }

  const key = keySet.get(kid);
  if (!key) {
    throw new Error(`kid ${header.kid} is not present in keySet`);
  }

  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signature, "base64url");
  } catch (e) {
    throw new Error("JWT header is invalid");
  }

  const verified = await verify(
    key,
    signatureBuf,
    Buffer.from(`${protectedHeader}.${payload}`)
  );
  if (!verified) {
    throw new Error("JWT signature did not validate");
  }

  let payloadData: Record<string, string | undefined>;
  try {
    payloadData = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ) as Record<string, string | undefined>;
  } catch (e) {
    throw new Error("JWT payload is invalid");
  }

  return validateClaims(kid, payloadData, expectedAud);
}

function validateClaims(
  kid: string,
  payload: Record<string, unknown>,
  expectedAud: string
): ValidateSuccess {
  const { aud, exp, nbf } = payload;

  if (!aud || !exp || !nbf) {
    throw new Error(
      "JWT must contain all of the following claims: aud, exp, nbf"
    );
  }

  if (typeof aud === "string") {
    if (aud !== expectedAud) {
      throw new Error("JWT aud claim is invalid");
    }
  } else {
    throw new Error("JWT aud claim is invalid");
  }

  const now = Math.floor(new Date().getTime() / 1000);

  if (typeof nbf !== "number") {
    throw new Error("nbf claim must be a number");
  }
  if (nbf > now) {
    throw new Error("nbf claim timestamp check failed");
  }

  if (typeof exp !== "number") {
    throw new Error("exp claim must be a number");
  }
  if (exp <= now) {
    throw new Error("exp claim timestamp check failed");
  }

  return { valid: true, validKey: kid, scheme: SCHEME_V1 };
}
