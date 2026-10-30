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
// This package keeps the old names working by translating them onto that
// API (see adapt.ts).

import {
  connect,
  type Connection,
  type LogSource,
  type RestateLogLevel,
} from "@restatedev/restate-sdk/node";
import { toConnectOptions, type ConnectTunnelOptions } from "./adapt.js";

export type { ConnectTunnelOptions, TunnelTlsOptions } from "./adapt.js";
export type { ReconnectRetryPolicy } from "@restatedev/restate-sdk/node";

/**
 * Handle returned by the deprecated {@link connectTunnel}: the `connect()`
 * {@link Connection} under its former field names.
 *
 * @deprecated Use `Connection` with `connect()` from `@restatedev/restate-sdk`.
 */
export interface TunnelConnection {
  /** Stop reconnecting, close the current connections, and wait for teardown. */
  close(): Promise<void>;
  /** Gracefully drain in-flight invocations, then stop. See `Connection.shutdown`. */
  shutdown(opts?: { graceMs?: number }): Promise<void>;
  /** Number of successful handshakes since `connectTunnel` was called. */
  readonly connectionCount: number;
  /** The deployment name. */
  readonly tunnelName: string;
  /**
   * The proxy **base** URL (`<proxy-host>:9080/<env-id>/<tunnel-name>`),
   * `undefined` until the first successful handshake.
   */
  readonly proxyUrl: string | undefined;
  /**
   * The full deployment registration URL (`<proxyUrl>/http/in-process/9080/`),
   * `undefined` until the first successful handshake.
   */
  readonly deploymentUrl: string | undefined;
  /** Set when the connection stopped on a non-retryable failure. */
  readonly error: Error | undefined;
  /** Resolves on the first successful handshake; rejects on a fatal stop before it. */
  readonly ready: Promise<void>;
}

const DEPRECATION =
  "connectTunnel() is deprecated: use connect({ services, name }) from @restatedev/restate-sdk with RESTATE_CONNECT_KEY from https://cloud.restate.dev/to/developers/integration#configure-sdk";
let deprecationLogged = false;

/**
 * Serve a deployment over an outbound connection to Restate Cloud, with the
 * identity spelled out as separate options. Translated onto `connect()`.
 *
 * @deprecated Use `connect({ services, name })` from `@restatedev/restate-sdk`
 * with `RESTATE_CONNECT_KEY` from the Cloud UI (Development → Configure SDK).
 */
export function connectTunnel(options: ConnectTunnelOptions): TunnelConnection {
  const connectOptions = toConnectOptions(options);
  if (!deprecationLogged) {
    deprecationLogged = true;
    if (connectOptions.logger !== undefined) {
      connectOptions.logger(
        {
          source: "SYSTEM" as LogSource,
          level: "warn" as RestateLogLevel,
          replaying: false,
        },
        DEPRECATION
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(DEPRECATION);
    }
  }
  const connection: Connection = connect(connectOptions);
  return {
    close: () => connection.close(),
    shutdown: (opts) => connection.shutdown(opts),
    get connectionCount() {
      return connection.connectionCount;
    },
    tunnelName: connection.name,
    get proxyUrl() {
      return connection.deploymentUrl?.replace(
        /\/http\/in-process\/9080\/$/,
        ""
      );
    },
    get deploymentUrl() {
      return connection.deploymentUrl;
    },
    get error() {
      return connection.error;
    },
    ready: connection.ready,
  };
}
