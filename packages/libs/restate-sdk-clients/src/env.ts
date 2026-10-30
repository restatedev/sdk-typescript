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

// Ingress connection from RESTATE_INGRESS_KEY.
//
// `connect()` without a `url` reads `RESTATE_INGRESS_KEY`, an ingress key from
// the Cloud UI (Development → Configure Client):
//
//   restate://<api key>@<bare environment id>.env.<region domain>/
//
// The ingress is `https://<host>:8080` and the API key is the bearer. Explicit
// options always win; with neither a `url` nor the variable, `connect()`
// fails fast, as it always required a `url`.

import { parseCloudKey } from "@restatedev/restate-sdk-core";
import type { ConnectionOpts } from "./api.js";

export const INGRESS_KEY_ENV = "RESTATE_INGRESS_KEY";
/** Where to get an ingress key (Development → Configure Client), linked in every error. */
const INGRESS_KEY_URL =
  "https://cloud.restate.dev/to/developers/integration#configure-client";

/** The ingress URL and bearer an ingress key stands for. */
export function ingressFromKey(
  value: string,
  what: string = INGRESS_KEY_ENV
): { url: string; token: string } {
  const key = parseCloudKey(value, what);
  if (key.apiKey === undefined) {
    throw new Error(
      `${what} carries no API key (restate://<api key>@…); copy it again from ${INGRESS_KEY_URL}`
    );
  }
  if (key.params.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `clients.connect(): ignoring unknown ${what} parameter(s) ${key.params.map(([name]) => JSON.stringify(name)).join(", ")}`
    );
  }
  return { url: `https://${key.host}:8080`, token: key.apiKey };
}

/** Connection options with the ingress URL settled. */
export type ResolvedConnectionOpts = ConnectionOpts & { url: string };

/** Resolve the connection options: the `url` (and bearer) from `RESTATE_INGRESS_KEY` when not given. */
export function resolveConnectionOpts(
  opts: ConnectionOpts
): ResolvedConnectionOpts {
  if (opts.url !== undefined && opts.url !== "") {
    return { ...opts, url: opts.url };
  }
  const value = process.env[INGRESS_KEY_ENV];
  if (value === undefined || value === "") {
    throw new Error(
      `clients.connect(): url is required — pass { url } (e.g. "http://localhost:8080") or set ${INGRESS_KEY_ENV} (create one at ${INGRESS_KEY_URL})`
    );
  }
  const { url, token } = ingressFromKey(value);
  const headers = { ...(opts.headers ?? {}) };
  const hasAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization"
  );
  if (!hasAuthorization) headers["Authorization"] = `Bearer ${token}`;
  return { ...opts, url, headers };
}
