/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Ingress connection defaults from the environment.
//
// `connect()` without a `url` configures itself from the same `.env` that
// `serve()` reads (written by `restate cloud link` or downloaded from the
// Cloud UI): `RESTATE_INGRESS_URL` for the address and `RESTATE_AUTH_TOKEN`
// for the bearer. Nothing set → `http://localhost:8080` with no auth, today's
// local-dev default. Explicit options always win.

import { loadEnvFile, readEnvVar } from "@restatedev/restate-sdk-core";
import type { ConnectionOpts } from "./api.js";

export const INGRESS_URL_ENV = "RESTATE_INGRESS_URL";
export const AUTH_TOKEN_ENV = "RESTATE_AUTH_TOKEN";
export const DEFAULT_INGRESS_URL = "http://localhost:8080";
const ENV_FILE = ".env";

/** Resolve the connection options: `url` and the bearer from the environment when not given. */
export function resolveConnectionOpts(
  opts: Partial<ConnectionOpts>
): ConnectionOpts {
  let url = opts.url;
  if (url === undefined || url === "") {
    // Only the auto-configuration path touches ./.env; never overrides.
    try {
      loadEnvFile(ENV_FILE);
    } catch {
      // Unreadable file: fall through to the defaults.
    }
    url = readEnvVar(INGRESS_URL_ENV) ?? DEFAULT_INGRESS_URL;
  }
  const headers = { ...(opts.headers ?? {}) };
  const hasAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization"
  );
  if (!hasAuthorization) {
    const token = readEnvVar(AUTH_TOKEN_ENV);
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
  }
  return { ...opts, url, headers };
}
