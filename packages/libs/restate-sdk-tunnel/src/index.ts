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

// @restatedev/restate-sdk-tunnel — the deprecated connectTunnel() API.
//
// Connecting to Restate Cloud is built into `@restatedev/restate-sdk`:
//
//   import * as restate from "@restatedev/restate-sdk";
//   restate.connect({ services: [greeter], name: "greeter-v1" });
//
// with `RESTATE_CONNECT_KEY` from the Cloud UI (Development → Configure SDK).
// This package is the only place the old names live on: the same engine,
// the original options and handle.

import {
  _connectTunnel,
  type _ConnectTunnelOptions,
  type _TunnelConnection,
  type _TunnelTlsOptions,
} from "@restatedev/restate-sdk/node";

/**
 * Serve a deployment over an outbound connection to Restate Cloud, with the
 * identity spelled out as separate options.
 *
 * @deprecated Use `connect({ services, name })` from `@restatedev/restate-sdk`
 * with `RESTATE_CONNECT_KEY` from the Cloud UI (Development → Configure SDK).
 */
export const connectTunnel: (
  options: ConnectTunnelOptions
) => TunnelConnection = _connectTunnel;

/** @deprecated Use `ConnectOptions` with `connect()` from `@restatedev/restate-sdk`. */
export type ConnectTunnelOptions = _ConnectTunnelOptions;
/** @deprecated Use `Connection` from `@restatedev/restate-sdk`. */
export type TunnelConnection = _TunnelConnection;
/** @deprecated Use `ConnectTlsOptions` from `@restatedev/restate-sdk`. */
export type TunnelTlsOptions = _TunnelTlsOptions;
export type { ReconnectRetryPolicy } from "@restatedev/restate-sdk/node";
