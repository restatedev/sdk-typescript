import { ed25519 } from "@noble/curves/ed25519"; // ESM and Common.js
import * as bs58 from "bs58";
import { Buffer } from "node:buffer";
import { headerValue, ValidateResponse } from "./validate";

const NONCE_HEADER = "x-restate-nonce";
const SECONDS_HEADER = "x-restate-unix-seconds";
const SIGNATURES_HEADER = "x-restate-signatures";
const PUBLIC_KEYS_HEADER = "x-restate-public-keys";

export type KeySetV1 = Map<string, Uint8Array>;

export function parseKeySetV1(keys: string[]): Map<string, Uint8Array> {
  const map = new Map();
  for (const key of keys) {
    map.set(key, bs58.decode(key));
  }
  return map;
}

export function validateV1(
  keySet: KeySetV1,
  method: string,
  path: string,
  headers: { [name: string]: string | string[] | undefined }
): ValidateResponse {
  const nonce = headerValue(NONCE_HEADER, headers);
  const seconds = headerValue(SECONDS_HEADER, headers);
  const signatures = headerValue(SIGNATURES_HEADER, headers);
  const keys = headerValue(PUBLIC_KEYS_HEADER, headers);

  if (!(nonce && seconds && signatures && keys)) {
    throw new Error(
      `v1 signature scheme expects the following headers: ${[
        SIGNATURES_HEADER,
        SECONDS_HEADER,
        NONCE_HEADER,
      ]}`
    );
  }

  const secondsInt = Number(seconds);
  const nowSeconds = Date.now() / 1000;
  const since = Math.abs(nowSeconds - secondsInt);
  if (since > 60 * 15) {
    throw new Error(
      `v1 signature scheme expects timestamp within 15 minutes of now; observed skew of ${since} seconds`
    );
  }

  const keysList = keys.split(",");
  const signatureList = signatures.split(",");

  if (keysList.length != signatureList.length) {
    throw new Error(
      "v1 signature scheme expects signature count and key count to be equal"
    );
  }

  const signed = Buffer.from(`${method}
${path}
${seconds}
${nonce}`);

  for (const [i, key] of keysList.entries()) {
    const keyBuffer = keySet.get(key);
    if (!keyBuffer) {
      // this public key is definitely not one we accept
      continue;
    }
    // the sender claims to have used a public key we accept, now verify the signature.
    const verified = ed25519.verify(
      Buffer.from(signatureList[i], "base64"),
      signed,
      keyBuffer
    );
    if (verified) {
      return { valid: true, validKey: key, scheme: "v1" };
    }
  }

  // we don't throw because no invariants are broken, we just don't happen to accept this caller.
  return { valid: false, invalidKeys: keysList, scheme: "v1" };
}
