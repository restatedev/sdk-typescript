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

// @restatedev/restate-sdk-tunnel — compatibility re-export.
//
// The tunnel engine now lives in `@restatedev/restate-sdk` (the `/node`
// entry): `restate.serve({ services })` connects to Restate Cloud on its own
// when `RESTATE_ENVIRONMENT_ID` and `RESTATE_AUTH_TOKEN` are configured, and
// `connectTunnel` is exported from there for programmatic use. This package
// keeps the old import path working.

export { connectTunnel } from "@restatedev/restate-sdk/node";
export type {
  ConnectTunnelOptions,
  ReconnectRetryPolicy,
  TunnelConnection,
  TunnelTlsOptions,
} from "@restatedev/restate-sdk/node";
