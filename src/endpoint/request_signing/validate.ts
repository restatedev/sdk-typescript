import { KeySetV1, validateV1 } from "./v1";

const SIGNATURE_SCHEME_HEADER = "x-restate-signature-scheme";

export type ValidateResponse =
  | { valid: true; validKey: string; scheme: string }
  | { valid: false; scheme: string };

export async function validateRequestSignature(
  keySet: KeySetV1,
  path: string,
  headers: { [name: string]: string | string[] | undefined }
): Promise<ValidateResponse> {
  const scheme = headerValue(SIGNATURE_SCHEME_HEADER, headers) ?? "unsigned";
  switch (scheme) {
    case "unsigned":
      return { valid: false, scheme: "unsigned" };
    case "v1":
      return await validateV1(keySet, path, headers);
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
