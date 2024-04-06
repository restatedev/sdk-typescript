import { Buffer } from "node:buffer";
import { headerValue, ValidateResponse, ValidateSuccess } from "./validate";
import { importKey, Key, verify } from "./ed25519";
import base from "./basex";

const JWT_HEADER = "x-restate-jwt-v1";
export const SCHEME_V1 = "v1";

export type KeySetV1 = Map<string, Promise<Key>>;

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

    // NB this returns a promise that we will only await during verification, and so failure here fails every JWT verif with this key
    // however, as long as we have 32 bytes, this really shouldn't fail (as long as there is runtime support for ed25519)
    // as curve25519 explicitly accepts any 32 bytes as a valid public key. Whether a private key can exist for that public key,
    // we could never know.
    const publicKey = importKey(Buffer.concat([asn1Prefix, pubBytes]));

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
    header = JSON.parse(Buffer.from(protectedHeader, "base64url").toString());
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

  const keyPromise = keySet.get(kid);
  if (!keyPromise) {
    throw new Error(`kid ${header.kid} is not present in keySet`);
  }

  let key: Key;
  try {
    key = await keyPromise;
  } catch (e) {
    throw new Error(
      `key ${header.kid} failed to parse on startup, this will affect all requests: ${e}`
    );
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
    payloadData = JSON.parse(Buffer.from(payload, "base64url").toString());
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
