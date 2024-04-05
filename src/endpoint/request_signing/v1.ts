import * as bs58 from "bs58";
import { Buffer } from "node:buffer";
import { headerValue, ValidateResponse } from "./validate";
import * as jose from "jose";

const JWT_HEADER = "x-restate-jwt-v1";
export const SCHEME_V1 = "v1";

export type KeySetV1 = Map<string, Promise<jose.KeyLike>>;

// SubjectPublicKeyInfo SEQUENCE (2 elem)
//   algorithm AlgorithmIdentifier SEQUENCE (1 elem)
//     algorithm OBJECT IDENTIFIER 1.3.101.112 curveEd25519 (EdDSA 25519 signature algorithm)
//   subjectPublicKey BIT STRING (256 bit) <insert 32 bytes after this>
const asn1Prefix = "MCowBQYDK2VwAyEA";

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
    const publicKey = jose.importSPKI(
      `-----BEGIN PUBLIC KEY-----
${asn1Prefix}${pubBytes.toString("base64")}
-----END PUBLIC KEY-----`,
      "EdDSA"
    );

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
    const result = await jose.jwtVerify(
      jwt,
      async (header) => {
        if (!header.kid) {
          throw new Error(`kid is not present in jwt header`);
        }
        const keyPromise = keySet.get(header.kid);
        if (!keyPromise) {
          throw new Error(`kid ${header.kid} is not present in keySet`);
        }

        try {
          return await keyPromise;
        } catch (e) {
          throw new Error(`kid ${header.kid} failed to parse: ${e}`);
        }
      },
      {
        algorithms: ["EdDSA"],
        audience: path,
        typ: "JWT",
        requiredClaims: ["aud", "exp", "iat", "nbf"],
      }
    );

    if (!result.protectedHeader.kid) {
      return {
        valid: false,
        scheme: SCHEME_V1,
        error: new Error(`kid is not present in validd jwheader`),
      };
    }

    return {
      valid: true,
      validKey: result.protectedHeader.kid,
      scheme: SCHEME_V1,
    };
  } catch (e) {
    return {
      valid: false,
      scheme: SCHEME_V1,
      error: e,
    };
  }
}
