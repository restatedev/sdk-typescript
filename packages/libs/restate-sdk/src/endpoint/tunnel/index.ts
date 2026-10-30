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

// The tunnel engine.
//
// Serve a Restate SDK deployment over an OUTBOUND connection to Restate
// Cloud's tunnel — no inbound HTTP listener, no public ingress to your
// network. `restate.serve()` uses it automatically in connect mode (when a
// Restate Cloud environment and credential are configured, see
// `cloud_env.ts`); `connectTunnel` is the lower-level entry point.
//
//   import { connectTunnel } from "@restatedev/restate-sdk/node";
//
//   connectTunnel({
//     region: "us",
//     environmentId: "env_...",
//     authToken: process.env.RESTATE_AUTH_TOKEN!,
//     signingPublicKey: "publickeyv1_...",
//     tunnelName: "my-cluster",
//     services: [greeter],
//   });
//
// Node-only (uses node:tls / node:http2 / node:dns).

export { connectTunnel } from "./connect.js";
export type {
  ConnectTunnelOptions,
  ReconnectRetryPolicy,
  TunnelConnection,
  TunnelTlsOptions,
} from "./types.js";
