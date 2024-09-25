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

import type { PathComponents } from "../../types/components.js";
import type { KeySetV1 } from "./v1.js";
import { SCHEME_V1, validateV1 } from "./v1.js";

const SIGNATURE_SCHEME_HEADER = "x-restate-signature-scheme";

export type ValidateResponse =
  | ValidateSuccess
  | { valid: false; error: unknown; scheme: string };

export type ValidateSuccess = { valid: true; validKey: string; scheme: string };

export async function validateRequestSignature(
  keySet: KeySetV1,
  path: PathComponents,
  headers: { [name: string]: string | string[] | undefined }
): Promise<ValidateResponse> {
  const scheme = headerValue(SIGNATURE_SCHEME_HEADER, headers) ?? "unsigned";
  switch (scheme) {
    case "unsigned":
      return {
        valid: false,
        scheme: "unsigned",
        error: new Error("request has no identity"),
      };
    case SCHEME_V1:
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
