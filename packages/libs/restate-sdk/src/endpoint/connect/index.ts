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

import { startEngine } from "../tunnel/engine.js";
import type {
  Connection,
  ConnectOptions,
  EngineHandle,
  EngineOptions,
} from "../tunnel/types.js";
import {
  registrationDeepLink,
  registrationIdentifier,
  resolveCoordinates,
  resolveName,
  type Coordinates,
} from "./env.js";
import { createLogger, type Logger } from "../../logging/logger.js";
import { LogSource } from "../../logging/logger_transport.js";
import { defaultLoggerTransport } from "../../logging/console_logger_transport.js";

/**
 * Connect your services to Restate Cloud and serve them over the connection —
 * no inbound listener, no public ingress to your network. The counterpart of
 * `serve()` for Restate Cloud: you either serve an HTTP endpoint or connect
 * outbound; the two never mix.
 *
 * ```ts
 * import * as restate from "@restatedev/restate-sdk";
 *
 * restate.connect({ services: [greeter], name: "greeter-v1" });
 * ```
 *
 * The connection needs two things:
 *
 * - a **name** for the deployment (`name` option, or `RESTATE_CONNECT_NAME`):
 *   the identity you register, shared by replicas of the same deployment;
 * - a **connect key** (`RESTATE_CONNECT_KEY`): one string from the Cloud UI,
 *   Development → Configure SDK, carrying the credential, the environment, the
 *   region and the request-identity key:
 *   `restate://<api key>@<environment id>.env.<region domain>/?signing-key=…`.
 *
 * Both are read from the process environment; the SDK never reads a file.
 *
 * Once connected, the SDK logs how to register the deployment, once:
 *
 * ```
 * Connecting to Restate Cloud environment env_201k… (eu.restate.cloud)
 * Connected as "greeter-v1"
 * Register it once:
 *   restate deployments register connect://greeter-v1
 *   or open https://cloud.restate.dev/to/overview?register-deployment=connect://greeter-v1
 * ```
 *
 * Registration is deliberately not automatic. Request identity validation is
 * always on (`identityKeys` defaults to the key's `signing-key`). Misconfiguration
 * throws synchronously, naming the variable to set; the returned
 * {@link Connection} reconnects in the background until closed, and its
 * `ready` promise settles with the first handshake.
 *
 * @param options the services, the name and the tuning, see {@link ConnectOptions}
 * @returns the connection handle
 */
export function connect(options: ConnectOptions): Connection {
  const {
    name: nameOption,
    key,
    identityKeys,
    connection = {},
    ...endpointOptions
  } = options;
  const { serversSrv, servers, ...tuning } = connection;
  const rlog = systemLogger(options);
  const name = resolveName(nameOption);
  const coordinates = resolveCoordinates(
    { key, identityKeys, serversSrv, servers },
    (message) => rlog.warn(message)
  );
  const handle = start(
    { ...endpointOptions, ...tuning },
    name,
    coordinates,
    rlog
  );
  return {
    ready: handle.ready,
    name: handle.name,
    get deploymentUrl() {
      return handle.deploymentUrl;
    },
    close: () => handle.close(),
    shutdown: (opts) => handle.shutdown(opts),
    get connectionCount() {
      return handle.connectionCount;
    },
    get error() {
      return handle.error;
    },
  };
}

/** The SDK system logger for the given endpoint options. */
export function systemLogger(options: {
  logger?: ConnectOptions["logger"];
}): Logger {
  return createLogger(
    options.logger ?? defaultLoggerTransport,
    LogSource.SYSTEM
  );
}

/**
 * Start the engine with resolved identity and log the banner on ready. Shared
 * by `connect()` and the legacy `connectTunnel()`.
 */
export function start(
  rest: Omit<
    EngineOptions,
    "name" | "environmentId" | "authToken" | "identityKeys" | "discovery"
  >,
  name: string,
  coordinates: Coordinates,
  rlog: Logger
): EngineHandle {
  const { regionLabel, ...engineCoordinates } = coordinates;
  // startEngine validates the tuning synchronously; log only once it did.
  const connection = startEngine({ ...rest, name, ...engineCoordinates });
  rlog.info(
    `Connecting to Restate Cloud environment ${coordinates.environmentId} (${regionLabel})`
  );
  connection.ready.then(
    () => {
      rlog.debug(`Deployment URL: ${connection.deploymentUrl ?? "?"}`);
      rlog.info(`Connected as "${name}"`);
      rlog.info("Register it once:");
      rlog.info(
        `  restate deployments register ${registrationIdentifier(name)}`
      );
      rlog.info(`  or open ${registrationDeepLink(name)}`);
    },
    () => {
      // The failure is on the handle (`error`, `ready`) and in the engine's
      // own error log; nothing to add here.
    }
  );
  return connection;
}
