/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

export * from "./common_api.js";
import type { RestateEndpoint } from "./endpoint.js";
import { NodeEndpoint } from "./endpoint/node_endpoint.js";
import type { EndpointOptions } from "./endpoint/types.js";
import { withOptions } from "./endpoint/withOptions.js";
import { startTunnel } from "./endpoint/tunnel/index.js";
import type { ConnectTunnelOptions } from "./endpoint/tunnel/index.js";
import {
  decideServeMode,
  registrationDeepLink,
  registrationIdentifier,
} from "./endpoint/cloud_env.js";
import { createLogger } from "./logging/logger.js";
import { LogSource } from "./logging/logger_transport.js";
import { defaultLoggerTransport } from "./logging/console_logger_transport.js";

export { connectTunnel } from "./endpoint/tunnel/index.js";
export type {
  ConnectTunnelOptions,
  ReconnectRetryPolicy,
  TunnelConnection,
  TunnelTlsOptions,
} from "./endpoint/tunnel/index.js";

/**
 * Create a new {@link RestateEndpoint}.
 * @deprecated Please use {@link createEndpointHandler}
 */
export function endpoint(): RestateEndpoint {
  return new NodeEndpoint();
}

/**
 * Options for creating a Node.js endpoint handler.
 *
 * Extends {@link EndpointOptions} with Node.js-specific options for controlling
 * the protocol mode.
 */
export interface NodeEndpointOptions extends EndpointOptions {
  /**
   * Controls the protocol mode used by the handler.
   *
   * - `undefined` (default): auto-detect based on HTTP version.
   *   HTTP/2+ uses bidirectional streaming (`BIDI_STREAM`),
   *   HTTP/1.1 uses request-response mode (`REQUEST_RESPONSE`).
   * - `true`: force `BIDI_STREAM` for all requests.
   * - `false`: force `REQUEST_RESPONSE` for all requests.
   */
  bidirectional?: boolean;
}

/**
 * Creates a request handler for the provided services.
 *
 * The returned handler auto-detects the HTTP protocol version per request:
 * - HTTP/2+ requests use bidirectional streaming (`BIDI_STREAM`)
 * - HTTP/1.1 requests use request-response mode (`REQUEST_RESPONSE`) by default
 *
 * Set `bidirectional: true` to force `BIDI_STREAM` for all requests, or
 * `bidirectional: false` to force `REQUEST_RESPONSE` for all requests.
 *
 * @example HTTP/2 server
 * ```
 * const httpServer = http2.createServer(createEndpointHandler({ services: [myService] }));
 * httpServer.listen(port);
 * ```
 *
 * @example HTTP/1.1 server
 * ```
 * const httpServer = http.createServer(createEndpointHandler({ services: [myService] }));
 * httpServer.listen(port);
 * ```
 *
 * @param {NodeEndpointOptions} options - Configuration options for the endpoint handler.
 * @returns A request handler function compatible with both HTTP/1.1 and HTTP/2 servers.
 */
export function createEndpointHandler(options: NodeEndpointOptions) {
  const { bidirectional, ...endpointOptions } = options;
  return withOptions<RestateEndpoint>(
    new NodeEndpoint(),
    endpointOptions
  ).handler({ bidirectional });
}

export type ServeMode = "listen" | "connect";

/**
 * Tunnel options for {@link serve} in connect mode: the same options as
 * {@link ConnectTunnelOptions} minus the endpoint options that {@link ServeOptions}
 * already carries (`services`, `logger`, `defaultServiceOptions`, …).
 *
 * Credentials and identity given here win over the environment.
 */
export type ServeConnectOptions = Omit<
  ConnectTunnelOptions,
  keyof EndpointOptions
>;

export interface ServeOptions extends EndpointOptions {
  /**
   * Listen mode: the port to bind. Defaults to the `PORT` environment
   * variable, then 9080. Ignored in connect mode.
   */
  port?: number;
  /**
   * Force a mode instead of detecting it from the environment:
   * `"listen"` binds an HTTP/2 server even when Restate Cloud variables are
   * present (CI, containers that happen to carry them); `"connect"` requires
   * the Cloud settings and fails otherwise. See {@link serve}.
   */
  mode?: ServeMode;
  /**
   * Programmatic Restate Cloud settings for connect mode (environment id,
   * credential, region, signing key, deployment name, tunnel tuning). Anything
   * left out is read from the environment, see {@link serve}.
   */
  connect?: ServeConnectOptions;
  /**
   * The dotenv file to load before deciding the mode. Default `.env`
   * (relative to the working directory); set `false` to load nothing, or a
   * path such as `.env.cloud`. Variables already set in the process
   * environment are never overridden, so this composes with
   * `node --env-file`, Bun's automatic `.env` loading, Docker and CI.
   */
  envFile?: string | false;
}

/**
 * Serves the given Restate services, in one of two modes decided once at startup:
 *
 * - **Listen mode** (the default): an HTTP/2 server bound to `port`, the `PORT`
 *   environment variable, or 9080. Restate calls this server; register it with
 *   its URL. If `RESTATE_SIGNING_PUBLIC_KEY` is set and `identityKeys` is not,
 *   requests are validated against that key.
 * - **Connect mode**: when a Restate Cloud environment and credential are
 *   configured (`RESTATE_ENVIRONMENT_ID` and `RESTATE_AUTH_TOKEN`, plus
 *   `RESTATE_CLOUD_REGION` and `RESTATE_SIGNING_PUBLIC_KEY`; the
 *   `RESTATE_INPROC_*` names are accepted as fallbacks), the services are
 *   served over an outbound tunnel connection to that environment — no
 *   inbound listener. The deployment name comes from `RESTATE_TUNNEL_NAME`
 *   (the tunnel server assigns one when unset, which changes on restart).
 *   The SDK prints how to register the deployment, once:
 *   `restate deployments register tunnel://<name>`, or the Cloud UI link.
 *   Registration is deliberately not automatic.
 *
 * Before deciding, `./.env` is loaded (if present, never overriding) so the
 * file `restate cloud link` writes is enough: run `restate cloud link` once per
 * project, then `serve({ services })` connects. Variables are looked up in the
 * process environment first, then the file. Opt out with `envFile: false`.
 *
 * An environment without a credential (or vice versa) fails fast naming the
 * missing variable; `mode` forces either behaviour, and `connect` passes
 * settings programmatically.
 *
 * The returned promise resolves with the bound port in listen mode, and with
 * `0` in connect mode once the first tunnel handshake succeeds. It rejects on a
 * bind failure, a misconfiguration, or a fatal tunnel error (e.g. a rejected
 * credential).
 *
 * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use {@link createEndpointHandler}.
 *
 * @param {ServeOptions} options - Configuration options for the endpoint handler.
 * @returns a Promise that resolves with the bound port (`0` in connect mode), or rejects with a failure otherwise.
 */
export function serve(options: ServeOptions): Promise<number> {
  const { port, mode, connect, envFile, ...endpointOptions } = options;
  const rlog = createLogger(
    endpointOptions.logger ?? defaultLoggerTransport,
    LogSource.SYSTEM
  );

  let decision: ReturnType<typeof decideServeMode>;
  try {
    decision = decideServeMode({
      mode,
      connect,
      envFile,
      log: (message) => rlog.info(message),
    });
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }

  if (decision.mode === "listen") {
    // RESTATE_SIGNING_PUBLIC_KEY is honoured in listen mode too, unless
    // identity keys are given explicitly.
    const identityKeys =
      endpointOptions.identityKeys ??
      (decision.signingPublicKey !== undefined
        ? [decision.signingPublicKey]
        : undefined);
    return withOptions<RestateEndpoint>(new NodeEndpoint(), {
      ...endpointOptions,
      identityKeys,
    }).listen(port);
  }

  rlog.info(
    `Connecting to Restate Cloud environment ${decision.environmentId} (${decision.discovery}) — from ${decision.source}`
  );
  const connection = startTunnel({
    // Ctrl-C in a terminal is SIGINT: drain and exit on it too.
    gracefulShutdown: { signals: ["SIGTERM", "SIGINT"] },
    ...connect,
    ...endpointOptions,
  });
  return connection.ready.then(() => {
    const name = connection.tunnelName ?? "?";
    rlog.info(`Connected as deployment "${name}"`);
    if (decision.ingressUrl !== undefined) {
      rlog.info(
        `Ingress: ${decision.ingressUrl} (clients.connect() is configured)`
      );
    }
    rlog.debug(`Deployment URL: ${connection.deploymentUrl ?? "?"}`);
    rlog.info("Register it once:");
    rlog.info(`  restate deployments register ${registrationIdentifier(name)}`);
    rlog.info(`  or open ${registrationDeepLink(name)}`);
    return 0;
  });
}
