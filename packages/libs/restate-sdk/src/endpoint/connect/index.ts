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
  CONNECT_KEY_ENV,
  CONNECT_KEY_URL,
  CONNECT_NAME_ENVS,
  type Coordinates,
  registrationDeepLink,
  registrationIdentifier,
  resolveCoordinates,
  resolveName,
} from "./env.js";
import { createLogger, type Logger } from "../../logging/logger.js";
import { LogSource } from "../../logging/logger_transport.js";
import { defaultLoggerTransport } from "../../logging/console_logger_transport.js";

/**
 * Connect your services to Restate Cloud and serve them over the connection.
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
 * - a **connect key** (`RESTATE_CONNECT_KEY`): one string you can obtain from
 *   Cloud UI -> Development → Configure SDK.
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
 * The returned {@link Connection} reconnects in the background until closed.
 *
 * @param options the services, the name and the tuning, see {@link ConnectOptions}
 * @returns the connection handle
 */
export function connect(options: ConnectOptions): Connection {
  const handle = connectEngine(options);
  // The fatal error is on the handle; surface it where the caller waits.
  const settled = async (done: Promise<void>): Promise<void> => {
    await done;
    if (handle.error !== undefined) throw handle.error;
  };
  return {
    ready: handle.ready,
    name: handle.name,
    close: () => settled(handle.close()),
    shutdown: (opts) => settled(handle.shutdown(opts)),
  };
}

/**
 * `connect()` without the projection: the engine handle, with the connection
 * count and the fatal error. Internal (tests).
 */
export function connectEngine(options: ConnectOptions): EngineHandle {
  const {
    name: nameOption,
    key,
    identityKeys,
    connection = {},
    ...endpointOptions
  } = options;
  const { serversSrv, servers, ...tuning } = connection;
  const rlog = createLogger(
    options.logger ?? defaultLoggerTransport,
    LogSource.SYSTEM
  );
  const name = resolveName(nameOption);
  const coordinates = resolveCoordinates(
    { key, identityKeys, serversSrv, servers },
    (message) => rlog.warn(message)
  );
  return start({ ...endpointOptions, ...tuning }, name, coordinates, rlog);
}

/**
 * Start the engine with resolved identity and log the banner on ready. Shared
 * by `connect()` and the legacy `connectTunnel()`.
 */
function start(
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
  const connection = startEngine({
    ...rest,
    name,
    ...engineCoordinates,
    onFatal: (error) => {
      for (const line of explainFatal(error, name, coordinates.environmentId)) {
        rlog.error(line);
      }
    },
  });
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
      // Explained by onFatal above (or a plain close() before the first handshake).
    }
  );
  return connection;
}

/**
 * A non-retryable stop, in plain words: what Restate Cloud said, what it
 * means, what to do. The engine's own `tunnel: FATAL — …` line stays at debug.
 */
function explainFatal(
  error: Error,
  name: string,
  environmentId: string
): string[] {
  const reason = error.message.replace(/^tunnel: /, "");
  const lines: string[] = [];
  if (reason.includes("tunnel-status: unauthorized")) {
    lines.push(
      `Restate Cloud rejected the connect key for environment ${environmentId}: it is invalid, revoked, or for another environment.`,
      `Create a new key at ${CONNECT_KEY_URL} and set ${CONNECT_KEY_ENV}.`
    );
  } else if (
    reason.includes("tunnel-status: bad-tunnel-name") ||
    reason.startsWith("tunnel-name mismatch")
  ) {
    lines.push(
      `Restate Cloud rejected the deployment name "${name}" (${reason}).`,
      `Use letters, digits, '.', '_' or '-' — ${CONNECT_NAME_ENVS[0]} or the name option.`
    );
  } else if (reason.startsWith("gave up reconnecting")) {
    lines.push(
      `Could not reach Restate Cloud for environment ${environmentId}: ${reason}.`,
      `Check the network, and that the key's region is right (${CONNECT_KEY_ENV}).`
    );
  } else {
    lines.push(`The connection to Restate Cloud stopped: ${reason}`);
  }
  lines.push("Not retrying. Fix the configuration and restart.");
  return lines;
}
