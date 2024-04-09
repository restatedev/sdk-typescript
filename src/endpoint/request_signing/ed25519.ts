import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import * as crypto from "node:crypto";

const USE_WEB_CRYPTO =
  globalThis.process?.env?.USE_WEB_CRYPTO == "true" ||
  globalThis.process?.release?.name !== "node";

export type Key =
  | { type: "web"; key: Promise<webcrypto.CryptoKey>; kid: string }
  | { type: "node"; key: crypto.KeyObject; kid: string };

export function importKey(kid: string, derBytes: Buffer): Key {
  if (!USE_WEB_CRYPTO) {
    return {
      type: "node",
      key: crypto.createPublicKey({
        key: derBytes,
        format: "der",
        type: "spki",
      }),
      kid,
    };
  } else {
    return {
      type: "web",
      key: webcrypto.subtle.importKey(
        "spki",
        derBytes,
        { name: "Ed25519" },
        false,
        ["verify"]
      ),
      kid,
    };
  }
}

export async function verify(
  key: Key,
  signatureBuf: Buffer,
  data: Buffer
): Promise<boolean> {
  if (key.type == "node") {
    return crypto.verify(null, data, key.key, signatureBuf);
  } else {
    let webKey: webcrypto.CryptoKey;
    try {
      webKey = await key.key;
    } catch (e) {
      throw new Error(
        `key ${key.kid} failed to parse on startup, this will affect all requests signed with it: ${e}`
      );
    }

    return await webcrypto.subtle.verify(
      { name: "Ed25519" },
      webKey,
      signatureBuf,
      data
    );
  }
}
