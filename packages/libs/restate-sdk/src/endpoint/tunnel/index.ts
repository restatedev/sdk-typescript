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

// The engine behind `connect()`: serves a Restate SDK deployment over an
// OUTBOUND connection to Restate Cloud — no inbound HTTP listener, no public
// ingress to your network. The directory keeps its historical name; the
// public API is `connect()` in ../connect.
//
// Node-only (uses node:tls / node:http2 / node:dns).

export { startEngine, buildDeploymentUrl } from "./engine.js";
export { srvNameForRegionDomain, requireHeaderSafe } from "./options.js";
export type {
  Connection,
  ConnectionOptions,
  ConnectOptions,
  ConnectTlsOptions,
  ConnectTuningOptions,
  ConnectTunnelOptions,
  EngineHandle,
  EngineOptions,
  ReconnectRetryPolicy,
  TunnelConnection,
  TunnelTlsOptions,
} from "./types.js";
