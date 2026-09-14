/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/**
 * Request identity verification, mirrors `request_identity.rs` of the shared
 * core. Verifies the `x-restate-jwt-v1` EdDSA (Ed25519) token using WebCrypto.
 */

import type { WasmHeader, WasmIdentityVerifier } from "../types.js";
import { utf8Decode, utf8Encode } from "./proto.js";

const SIGNATURE_SCHEME_HEADER = "x-restate-signature-scheme";
const SIGNATURE_SCHEME_V1 = "v1";
const SIGNATURE_SCHEME_UNSIGNED = "unsigned";
const SIGNATURE_JWT_V1_HEADER = "x-restate-jwt-v1";
const IDENTITY_V1_PREFIX = "publickeyv1_";

// --- Minimal WebCrypto typing, to stay runtime neutral

interface SubtleCryptoLike {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[]
  ): Promise<unknown>;
  verify(
    algorithm: string | { name: string },
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array
  ): Promise<boolean>;
}

function subtle(): SubtleCryptoLike {
  const s = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto
    ?.subtle;
  if (s === undefined) {
    throw new Error(
      "WebCrypto (globalThis.crypto.subtle) is not available in this runtime, cannot verify request identity"
    );
  }
  return s;
}

// --- Base58 (bitcoin alphabet)

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  if (s.length === 0) {
    return new Uint8Array(0);
  }
  // Count leading zeros
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") {
    zeros++;
  }
  // Convert
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const c = s[i]!;
    const digit = BASE58_ALPHABET.indexOf(c);
    if (digit < 0) {
      throw new Error(
        `provided string contained invalid character '${c}' at byte ${i}`
      );
    }
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  // bytes is little endian
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

// --- Base64 url

// URL-safe alphabet, no padding: the shared core decodes JWT segments with
// base64 `URL_SAFE_NO_PAD`, which rejects both `+`/`/` and `=`.
const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlDecode(s: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of s) {
    const v = BASE64_URL_ALPHABET.indexOf(c);
    if (v < 0) {
      throw new Error("invalid base64url character");
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// --- JWT

class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

interface ParsedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signedData: Uint8Array;
  signature: Uint8Array;
}

function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("InvalidToken");
  }
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(utf8Decode(base64UrlDecode(h)));
  } catch {
    throw new JwtError("Base64 error: invalid JWT header");
  }
  try {
    claims = JSON.parse(utf8Decode(base64UrlDecode(p)));
  } catch {
    throw new JwtError("Base64 error: invalid JWT claims");
  }
  if (typeof header !== "object" || header === null) {
    throw new JwtError("InvalidToken");
  }
  if (typeof claims !== "object" || claims === null) {
    throw new JwtError("InvalidToken");
  }
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(s);
  } catch {
    throw new JwtError("Base64 error: invalid JWT signature");
  }
  return {
    header: header as Record<string, unknown>,
    claims: claims as Record<string, unknown>,
    signedData: utf8Encode(`${h}.${p}`),
    signature,
  };
}

// The shared core deserializes `exp`/`nbf` into `u64`, rounding the JSON number
// and rejecting anything outside the range.
const U64_MAX_AS_F64 = 18446744073709551615;

function claimAsU64(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined;
  }
  const rounded = Math.round(v);
  if (rounded < 0 || rounded > U64_MAX_AS_F64) {
    return undefined;
  }
  return rounded;
}

function validateClaims(claims: Record<string, unknown>, audience: string) {
  // `iat` is deliberately absent: the shared core lists it as a required spec
  // claim, but jsonwebtoken only enforces `exp`/`sub`/`iss`/`aud`/`nbf` and
  // ignores the rest, so a token without `iat` is accepted there.
  for (const required of ["aud", "exp", "nbf"]) {
    if (!(required in claims)) {
      throw new JwtError(`Missing required claim: ${required}`);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = claimAsU64(claims["exp"]);
  if (exp === undefined || exp < now) {
    throw new JwtError("ExpiredSignature");
  }
  const nbf = claimAsU64(claims["nbf"]);
  if (nbf === undefined || nbf > now) {
    throw new JwtError("ImmatureSignature");
  }
  const aud = claims["aud"];
  // The audience claim is a string or an array of strings; anything else is
  // a deserialization failure, not a non-match.
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.every((a) => typeof a === "string")) {
    throw new JwtError("InvalidAudience");
  }
  if (!audiences.includes(audience)) {
    throw new JwtError("InvalidAudience");
  }
}

/** Normalises the request path the same way the shared core does. */
export function normalisePath(path: string): string {
  const slashes: number[] = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "/") {
      slashes.push(i);
    }
  }
  if (
    slashes.length >= 3 &&
    path.substring(
      slashes[slashes.length - 3]!,
      slashes[slashes.length - 2]
    ) === "/invoke"
  ) {
    return path.substring(slashes[slashes.length - 3]!);
  } else if (
    slashes.length > 0 &&
    path.substring(slashes[slashes.length - 1]!) === "/discover"
  ) {
    return path.substring(slashes[slashes.length - 1]!);
  }
  return path;
}

function extractHeader(
  headers: readonly WasmHeader[],
  name: string
): string | undefined {
  for (const h of headers) {
    if (h.key.toLowerCase() === name) {
      return h.value;
    }
  }
  return undefined;
}

export class IdentityVerifier implements WasmIdentityVerifier {
  private readonly rawKeys: Uint8Array[] = [];
  private cryptoKeys: Promise<unknown[]> | undefined = undefined;

  constructor(keys: string[]) {
    for (const key of keys) {
      this.rawKeys.push(IdentityVerifier.parseKey(key));
    }
  }

  private static parseKey(key: string): Uint8Array {
    if (!key.startsWith(IDENTITY_V1_PREFIX)) {
      throw new Error(
        `identity v1 jwt public keys are expected to start with ${IDENTITY_V1_PREFIX}`
      );
    }
    let decoded: Uint8Array;
    try {
      decoded = base58Decode(key.substring(IDENTITY_V1_PREFIX.length));
    } catch (e) {
      throw new Error(
        `cannot decode the public key with base58: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (decoded.length !== 32) {
      throw new Error(
        `decoded key should have length of 32, was ${decoded.length}`
      );
    }
    return decoded;
  }

  private loadKeys(): Promise<unknown[]> {
    if (this.cryptoKeys === undefined) {
      const s = subtle();
      this.cryptoKeys = Promise.all(
        this.rawKeys.map((raw) =>
          s.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"])
        )
      );
    }
    return this.cryptoKeys;
  }

  private async checkV1Keys(jwtToken: string, path: string): Promise<void> {
    const parsed = parseJwt(jwtToken);
    if (parsed.header["alg"] !== "EdDSA") {
      throw new Error("invalid JWT: InvalidAlgorithm");
    }
    const keys = await this.loadKeys();
    const s = subtle();
    let lastError: unknown = new JwtError("InvalidSignature");
    for (const key of keys) {
      let valid = false;
      try {
        valid = await s.verify(
          "Ed25519",
          key,
          parsed.signature,
          parsed.signedData
        );
      } catch (e) {
        lastError = e;
        continue;
      }
      if (!valid) {
        lastError = new JwtError("InvalidSignature");
        continue;
      }
      try {
        validateClaims(parsed.claims, path);
        return;
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(
      `invalid JWT: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  async verify_identity(path: string, headers: WasmHeader[]): Promise<void> {
    if (this.rawKeys.length === 0) {
      return;
    }

    const schemeHeader = extractHeader(headers, SIGNATURE_SCHEME_HEADER);
    if (schemeHeader === undefined) {
      throw new Error(`missing header: ${SIGNATURE_SCHEME_HEADER}`);
    }

    switch (schemeHeader) {
      case SIGNATURE_SCHEME_V1: {
        const jwt = extractHeader(headers, SIGNATURE_JWT_V1_HEADER);
        if (jwt === undefined) {
          throw new Error(`missing header: ${SIGNATURE_JWT_V1_HEADER}`);
        }
        await this.checkV1Keys(jwt, normalisePath(path));
        return;
      }
      case SIGNATURE_SCHEME_UNSIGNED:
        throw new Error(
          "got unsigned request, expecting only signed requests matching the configured keys"
        );
      default:
        throw new Error(
          `bad ${SIGNATURE_SCHEME_HEADER} header, unexpected value ${schemeHeader}`
        );
    }
  }
}
