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

// The legacy API: connectTunnel() with its original options and handle. Not
// part of @restatedev/restate-sdk's public surface — it is reached only
// through @restatedev/restate-sdk-tunnel, which re-exports this module.

import type {
  ConnectTunnelOptions,
  TunnelConnection,
} from "../tunnel/types.js";
import {
  CONNECT_KEY_URL,
  coordinatesFromExpanded,
  hasExpandedOverrides,
  resolveCoordinates,
  resolveName,
} from "./env.js";
import { start, systemLogger } from "./index.js";

export type {
  ConnectTunnelOptions,
  TunnelConnection,
  TunnelTlsOptions,
} from "../tunnel/types.js";

let deprecationLogged = false;

/**
 * The former entry point, with the identity spelled out as separate fields.
 * Same engine as `connect()`: an explicit `region` / `environmentId` /
 * `authToken` / `signingPublicKey` is honoured (each falling back to its
 * environment variable); without any of them the call resolves exactly like
 * `connect()`, so a `RESTATE_CONNECT_KEY` works here too.
 *
 * @deprecated Use `connect({ services, name })` from `@restatedev/restate-sdk`
 * with `RESTATE_CONNECT_KEY` from the Cloud UI (Development → Configure SDK).
 */
export function connectTunnel(options: ConnectTunnelOptions): TunnelConnection {
  const {
    region,
    environmentId,
    authToken,
    signingPublicKey,
    tunnelName,
    tunnelServersSrv,
    tunnelServers,
    tunnelWorkerId,
    tunnelDiagnosticLogger,
    ...rest
  } = options;
  const rlog = systemLogger(options);
  if (!deprecationLogged) {
    deprecationLogged = true;
    rlog.warn(
      `connectTunnel() is deprecated: use connect({ services, name }) from @restatedev/restate-sdk with RESTATE_CONNECT_KEY from ${CONNECT_KEY_URL}`
    );
  }
  const name = resolveName(tunnelName);
  const expanded = {
    region,
    environmentId,
    authToken,
    signingPublicKey,
    serversSrv: tunnelServersSrv,
    servers: tunnelServers,
  };
  const coordinates = hasExpandedOverrides(expanded)
    ? coordinatesFromExpanded(expanded)
    : resolveCoordinates(
        { serversSrv: tunnelServersSrv, servers: tunnelServers },
        (message) => rlog.warn(message)
      );
  const handle = start(
    {
      ...rest,
      workerId: tunnelWorkerId,
      diagnosticLogger: tunnelDiagnosticLogger,
    },
    name,
    coordinates,
    rlog
  );
  return {
    close: () => handle.close(),
    shutdown: (opts) => handle.shutdown(opts),
    get connectionCount() {
      return handle.connectionCount;
    },
    get tunnelName() {
      return handle.tunnelName;
    },
    get proxyUrl() {
      return handle.proxyUrl;
    },
    get tunnelUrl() {
      return handle.tunnelUrl;
    },
    get deploymentUrl() {
      return handle.deploymentUrl;
    },
    get error() {
      return handle.error;
    },
    ready: handle.ready,
  };
}
