import { KeySetV1, validateV1 } from "./v1";

const PUBLIC_KEYS_HEADER = "x-restate-signature-scheme";

export type ValidateResponse =
  | { valid: true; validKey: string; scheme: string }
  | { valid: false; invalidKeys: string[]; scheme: string };

export function validateRequestSignature(
  keySet: KeySetV1,
  method: string,
  path: string,
  headers: { [name: string]: string | string[] | undefined }
): ValidateResponse {
  const scheme = headerValue(PUBLIC_KEYS_HEADER, headers) ?? "unsigned";
  switch (scheme) {
    case "unsigned":
      return { valid: false, invalidKeys: [], scheme: "unsigned" };
    case "v1":
      return validateV1(keySet, method, path, headers);
    default:
      throw new Error(
        "Unexpected signature scheme: known schemes are 'unsigned', 'v1'"
      );
  }
}

export function headerValue(
  key: string,
  headers: { [name: string]: string | string[] | undefined }
): string | null {
  if (!headers[key]) {
    return null;
  }
  if (typeof headers[key] !== "string") {
    throw new Error(`Unexpected multi-valued header ${key}`);
  }
  if (!headers[key]?.length) {
    throw new Error(`Unexpected empty valued header ${key}`);
  }
  return headers[key] as string;
}
