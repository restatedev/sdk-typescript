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

// The engine tests predate connect() and spell the identity out as separate
// fields. This test-only shim turns them into connect() options: the identity
// becomes the key string it encodes, the tuning moves under `connection`, and
// the raw diagnostic hook becomes a logger transport that receives the
// engine's `tunnel: …` lines.

import { connectEngine } from "../../src/endpoint/connect/index.js";
import type {
  ConnectionOptions,
  EngineHandle,
} from "../../src/endpoint/tunnel/types.js";
import type { EndpointOptions } from "../../src/endpoint/types.js";
import type { LoggerTransport } from "../../src/logging/logger_transport.js";

export interface ConnectTunnelOptions
  extends
    Omit<EndpointOptions, "identityKeys">,
    Omit<ConnectionOptions, "servers" | "serversSrv" | "workerId"> {
  region?: string;
  tunnelServersSrv?: string;
  tunnelServers?: string[];
  environmentId: string;
  authToken: string;
  signingPublicKey: string;
  tunnelName: string;
  tunnelWorkerId?: string;
  tunnelDiagnosticLogger?: (message: string) => void;
}

export function connectTunnel(options: ConnectTunnelOptions): EngineHandle {
  const {
    region,
    tunnelServersSrv,
    tunnelServers,
    environmentId,
    authToken,
    signingPublicKey,
    tunnelName,
    tunnelWorkerId,
    tunnelDiagnosticLogger,
    services,
    defaultServiceOptions,
    logger,
    journalValueCodecProvider,
    ...tuning
  } = options;
  const regionDomain =
    region !== undefined ? `${region}.restate.cloud` : "example.test";
  const key = `restate://${encodeURIComponent(authToken)}@${environmentId.replace(/^env_/, "")}.env.${regionDomain}/?signing-key=${signingPublicKey}`;
  const hooked: LoggerTransport | undefined =
    tunnelDiagnosticLogger === undefined
      ? logger
      : (params, message, ...rest) => {
          const text = String(message);
          if (text.startsWith("tunnel:")) tunnelDiagnosticLogger(text);
          else logger?.(params, message, ...rest);
        };
  return connectEngine({
    services,
    defaultServiceOptions,
    journalValueCodecProvider,
    logger: hooked,
    name: tunnelName,
    key,
    connection: {
      ...tuning,
      serversSrv: tunnelServersSrv,
      servers: tunnelServers,
      workerId: tunnelWorkerId,
    },
  });
}
