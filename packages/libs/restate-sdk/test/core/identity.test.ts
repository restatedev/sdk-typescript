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

import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import {
  base58Decode,
  IdentityVerifier,
  normalisePath,
} from "../../src/endpoint/handlers/vm/ts/identity.js";
import * as wasm from "../../src/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";

const SIGNATURE_SCHEME_HEADER = "x-restate-signature-scheme";
const SIGNATURE_JWT_V1_HEADER = "x-restate-jwt-v1";
const IDENTITY_V1_PREFIX = "publickeyv1_";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]!];
  }
  return out;
}

function b64url(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  return buf.toString("base64url");
}

/** Generates an Ed25519 key pair and a signed JWT, like the Rust test does. */
function mockTokenAndKey(
  claims: Record<string, unknown> = {},
  alg = "EdDSA"
): { jwt: string; identityKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const publicKeyBytes = Buffer.from(jwk.x, "base64url");
  const kid = `${IDENTITY_V1_PREFIX}${base58Encode(publicKeyBytes)}`;

  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg, kid };
  const payload: Record<string, unknown> = {
    aud: "/invoke/foo",
    nbf: now - 60,
    iat: now,
    exp: now + 60,
    ...claims,
  };
  // An explicit `undefined` means "omit this claim"
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) {
      delete payload[k];
    }
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = nodeSign(null, Buffer.from(signingInput), privateKey);
  return { jwt: `${signingInput}.${b64url(signature)}`, identityKey: kid };
}

function headers(jwt: string, scheme = "v1") {
  return [
    { key: SIGNATURE_SCHEME_HEADER, value: scheme },
    { key: SIGNATURE_JWT_V1_HEADER, value: jwt },
  ];
}

describe("identity verification", () => {
  it("verify", async () => {
    const { jwt, identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await verifier.verify_identity("/invoke/foo", headers(jwt));
  });

  it("verify is accepted by the WASM verifier too", () => {
    // The inlined WASM module is instantiated lazily by the selector
    wasm.initSync();
    const { jwt, identityKey } = mockTokenAndKey();
    const verifier = new wasm.WasmIdentityVerifier([identityKey]);
    verifier.verify_identity(
      "/invoke/foo",
      headers(jwt).map((h) => new wasm.WasmHeader(h.key, h.value))
    );
  });

  it("verify with prefixed path", async () => {
    // The audience is the normalised path: only the trailing /invoke/<svc>/<handler>
    const { jwt, identityKey } = mockTokenAndKey({ aud: "/invoke/svc/foo" });
    const verifier = new IdentityVerifier([identityKey]);
    await verifier.verify_identity("/some/prefix/invoke/svc/foo", headers(jwt));
  });

  it("bad key", async () => {
    const verifier = new IdentityVerifier([
      "publickeyv1_ChjENKeMvCtRnqG2mrBK1HmPKufgFUc98K8B3ononQvp",
    ]);
    await expect(
      verifier.verify_identity(
        "/invoke/foo",
        headers(
          "eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSIsImtpZCI6InB1YmxpY2tleXYxX0FmUXdtd2ZnRVpocldwdnY4TjUyU0hwUnRacUdHYUZyNEFaTjZxdFlXU2lZIn0.eyJhdWQiOiIvaW52b2tlL2ZvbyIsImV4cCI6MTcyMTY2MjcwOSwiaWF0IjoxNzIxNjYyNjQ5LCJuYmYiOjE3MjE2NjI1ODl9.UBReG_9cdFQ5VcaJxAV0rM8U_zaNw9kMXJZt691SiI0SWw7Ucmz5Zz3wtmVUc1jrkNsnTDhNEvOFGEZoKXTMCQ"
        )
      )
    ).rejects.toThrow("invalid JWT");
  });

  it("rejects wrong audience", async () => {
    const { jwt, identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/bar", headers(jwt))
    ).rejects.toThrow("invalid JWT: InvalidAudience");
  });

  it("rejects expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { jwt, identityKey } = mockTokenAndKey({ exp: now - 10 });
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/foo", headers(jwt))
    ).rejects.toThrow("invalid JWT: ExpiredSignature");
  });

  it("rejects token from another key", async () => {
    const { jwt } = mockTokenAndKey();
    const { identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/foo", headers(jwt))
    ).rejects.toThrow("invalid JWT: InvalidSignature");
  });

  it("accepts when any of the keys matches", async () => {
    const { jwt, identityKey } = mockTokenAndKey();
    const other = mockTokenAndKey().identityKey;
    const verifier = new IdentityVerifier([other, identityKey]);
    await verifier.verify_identity("/invoke/foo", headers(jwt));
  });

  it("rejects wrong algorithm", async () => {
    const { jwt, identityKey } = mockTokenAndKey({}, "HS256");
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/foo", headers(jwt))
    ).rejects.toThrow("invalid JWT: InvalidAlgorithm");
  });

  it("rejects unsigned requests", async () => {
    const { identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/foo", [
        { key: SIGNATURE_SCHEME_HEADER, value: "unsigned" },
      ])
    ).rejects.toThrow("got unsigned request");
  });

  it("rejects missing scheme header", async () => {
    const { identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await expect(verifier.verify_identity("/invoke/foo", [])).rejects.toThrow(
      `missing header: ${SIGNATURE_SCHEME_HEADER}`
    );
  });

  it("rejects bad scheme header", async () => {
    const { identityKey } = mockTokenAndKey();
    const verifier = new IdentityVerifier([identityKey]);
    await expect(
      verifier.verify_identity("/invoke/foo", [
        { key: SIGNATURE_SCHEME_HEADER, value: "v2" },
      ])
    ).rejects.toThrow(
      "bad x-restate-signature-scheme header, unexpected value v2"
    );
  });

  it("rejects keys without prefix", () => {
    expect(() => new IdentityVerifier(["nope"])).toThrow(
      "identity v1 jwt public keys are expected to start with publickeyv1_"
    );
  });

  it("rejects keys of wrong length", () => {
    expect(() => new IdentityVerifier(["publickeyv1_abc"])).toThrow(
      "decoded key should have length of 32"
    );
  });

  it("base58 decodes like the Rust implementation", () => {
    const decoded = base58Decode(
      "ChjENKeMvCtRnqG2mrBK1HmPKufgFUc98K8B3ononQvp"
    );
    expect(decoded.length).toBe(32);
    expect(base58Encode(decoded)).toBe(
      "ChjENKeMvCtRnqG2mrBK1HmPKufgFUc98K8B3ononQvp"
    );
    expect(base58Decode("11")).toEqual(new Uint8Array([0, 0]));
  });

  // The WASM build of the shared core is the reference implementation. These
  // cases all diverged from it at some point, so they are checked against it
  // directly rather than against a hand-written expectation.
  describe("agrees with the WASM verifier", () => {
    function wasmAccepts(path: string, jwt: string, key: string): boolean {
      wasm.initSync();
      try {
        new wasm.WasmIdentityVerifier([key]).verify_identity(
          path,
          headers(jwt).map((h) => new wasm.WasmHeader(h.key, h.value))
        );
        return true;
      } catch {
        return false;
      }
    }

    async function tsAccepts(
      path: string,
      jwt: string,
      key: string
    ): Promise<boolean> {
      try {
        await new IdentityVerifier([key]).verify_identity(path, headers(jwt));
        return true;
      } catch {
        return false;
      }
    }

    const now = () => Math.floor(Date.now() / 1000);

    it.each([
      // jsonwebtoken only enforces exp/sub/iss/aud/nbf; a token with no `iat`
      // is valid there, so rejecting it would lock out real deployments.
      ["no iat claim", () => ({ iat: undefined })],
      ["fractional exp just in the past", () => ({ exp: now() - 0.4 })],
      ["fractional nbf just in the future", () => ({ nbf: now() + 0.4 })],
      ["exp outside u64", () => ({ exp: 1e30 })],
      ["negative nbf", () => ({ nbf: -1 })],
      [
        "aud array with a non-string entry",
        () => ({ aud: ["/invoke/foo", 1] }),
      ],
      [
        "aud array containing the path",
        () => ({ aud: ["/other", "/invoke/foo"] }),
      ],
    ])("%s", async (_name, claims) => {
      const overrides = claims() as Record<string, unknown>;
      const { jwt, identityKey } = mockTokenAndKey(overrides);
      expect(await tsAccepts("/invoke/foo", jwt, identityKey)).toBe(
        wasmAccepts("/invoke/foo", jwt, identityKey)
      );
    });
  });

  it("rejects a JWT using the standard base64 alphabet", async () => {
    // The shared core decodes segments with URL_SAFE_NO_PAD, which rejects
    // both `+`/`/` and `=`.
    const { jwt, identityKey } = mockTokenAndKey();
    const [h, p, sig] = jwt.split(".");
    const padded = `${h}.${Buffer.from(p!, "base64url").toString("base64")}.${sig}`;
    if (padded === jwt) {
      return; // this payload happens to have no distinguishing characters
    }
    await expect(
      new IdentityVerifier([identityKey]).verify_identity(
        "/invoke/foo",
        headers(padded)
      )
    ).rejects.toThrow();
  });

  it("normalise path", () => {
    const paths: [string, string][] = [
      ["/invoke/a/b", "/invoke/a/b"],
      ["/foo/invoke/a/b", "/invoke/a/b"],
      ["/foo/bar/invoke/a/b", "/invoke/a/b"],
      ["/discover", "/discover"],
      ["/foo/discover", "/discover"],
      ["/foo/bar/discover", "/discover"],
      ["/foo", "/foo"],
      ["/invoke", "/invoke"],
      ["/foo/invoke", "/foo/invoke"],
      ["/invoke/a", "/invoke/a"],
      ["/foo/invoke/a", "/foo/invoke/a"],
      ["", ""],
      ["/", "/"],
      ["//", "//"],
      ["///", "///"],
      ["////", "////"],
      ["discover", "discover"],
      ["foo/discover", "/discover"],
      ["foo/invoke/a/b", "/invoke/a/b"],
    ];

    for (const [path, expected] of paths) {
      expect(normalisePath(path), path).toBe(expected);
    }
  });
});
