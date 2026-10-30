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

// connectTunnel() options → connect() options.
//
// The old API spelled the identity out as separate fields (region,
// environmentId, authToken, signingPublicKey, tunnelName) and the tuning flat.
// connect() takes a name, one key string and a `connection` block; the key is
// exactly what those fields encode, so the adapter synthesizes it:
//
//   restate://<authToken>@<bare environment id>.env.<region>.restate.cloud/?signing-key=<signingPublicKey>
//
// Fields left out fall back the way they always did — the RESTATE_INPROC_*
// variables the restate-operator injects — either here (the host needs the
// environment id and region) or inside connect() (token, token file, signing
// key, and the whole identity when none of the fields is given).

import type {
  ConnectOptions,
  ConnectTlsOptions,
  ConnectTuningOptions,
  EndpointOptions,
  LoggerTransport,
} from "@restatedev/restate-sdk/node";

/**
 * TLS options under their former name.
 * @deprecated Use `ConnectTlsOptions` from `@restatedev/restate-sdk`.
 */
export type TunnelTlsOptions = ConnectTlsOptions;

/**
 * Options for the deprecated `connectTunnel()`: the identity spelled out as
 * separate fields instead of `connect()`'s single key.
 *
 * The identity and discovery options fall back to `RESTATE_INPROC_*`
 * environment variables when not given (option > environment > throw):
 * `tunnelName` ← `RESTATE_INPROC_TUNNEL_NAME`, `environmentId` ←
 * `RESTATE_INPROC_ENVIRONMENT_ID`, `region` ← `RESTATE_INPROC_CLOUD_REGION`,
 * `signingPublicKey` ← `RESTATE_INPROC_SIGNING_PUBLIC_KEY`, and `authToken`
 * ← the file named by `RESTATE_INPROC_AUTH_TOKEN_FILE` (re-read on every
 * reconnect, so rotations are picked up). The
 * [restate-operator](https://github.com/restatedev/restate-operator)
 * injects the first four into the pods of a `tunnelMode: in-process`
 * RestateDeployment and registers the matching URL — there,
 * `connectTunnel({ services })` plus a token-file Secret mount is a complete
 * configuration.
 *
 * @deprecated Use `ConnectOptions` with `connect()` from `@restatedev/restate-sdk`.
 */
export interface ConnectTunnelOptions
  extends
    Omit<EndpointOptions, "identityKeys">,
    Omit<ConnectTuningOptions, "tls"> {
  /**
   * Restate Cloud region (e.g. `"us"`, `"eu"`), discovered via
   * `tunnel.<region>.restate.cloud`. Exactly one of `region`,
   * `tunnelServersSrv` or `tunnelServers`; falls back to
   * `RESTATE_INPROC_CLOUD_REGION`.
   */
  region?: string;
  /** A DNS SRV name to discover tunnel servers from (custom domains). */
  tunnelServersSrv?: string;
  /**
   * Explicit tunnel server addresses (`"host:port"` or `"https://host:port"`
   * / `"http://host:port"`), instead of DNS discovery.
   */
  tunnelServers?: string[];
  /** The environment id including the `env_` prefix; falls back to `RESTATE_INPROC_ENVIRONMENT_ID`. */
  environmentId?: string;
  /**
   * A Restate Cloud API key (`key_...`); falls back to the file named by
   * `RESTATE_INPROC_AUTH_TOKEN_FILE`, re-read on every reconnect.
   */
  authToken?: string;
  /** The environment's request-identity public key (`publickeyv1_…`); falls back to `RESTATE_INPROC_SIGNING_PUBLIC_KEY`. */
  signingPublicKey?: string;
  /** The deployment name (e.g. `"greeter-v1"`); falls back to `RESTATE_INPROC_TUNNEL_NAME`. */
  tunnelName?: string;
  /** Diagnostic worker id sent in the handshake; defaults to a stable hostname-based id. */
  tunnelWorkerId?: string;
  /** TLS for the outbound connection; `false` for plaintext dev/test setups. */
  tls?: boolean | TunnelTlsOptions;
  /**
   * Raw diagnostic hook: receives the engine's `tunnel: …` log lines (all
   * levels) instead of the SDK logger.
   */
  tunnelDiagnosticLogger?: (message: string) => void;
}

/** The variables the adapter itself needs for the key's host, in order. */
const ENVIRONMENT_ID_ENVS = [
  "RESTATE_ENVIRONMENT_ID",
  "RESTATE_INPROC_ENVIRONMENT_ID",
];
const CLOUD_REGION_ENVS = [
  "RESTATE_CLOUD_REGION",
  "RESTATE_INPROC_CLOUD_REGION",
];
const SIGNING_PUBLIC_KEY_ENVS = [
  "RESTATE_SIGNING_PUBLIC_KEY",
  "RESTATE_INPROC_SIGNING_PUBLIC_KEY",
];

function fromEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function given(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * Build the `connect()` options for the legacy ones. Pure: reads the
 * environment only for the key's host when the identity is partly explicit.
 */
export function toConnectOptions(
  options: ConnectTunnelOptions
): ConnectOptions {
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
    services,
    defaultServiceOptions,
    logger,
    journalValueCodecProvider,
    ...tuning
  } = options;

  // Any explicit identity field → a key carrying what is explicit; the rest
  // of the identity still resolves from the environment, inside connect()
  // (token, token file, signing key) or here (the host).
  let key: string | undefined;
  if (
    given(region) ||
    given(environmentId) ||
    given(authToken) ||
    given(signingPublicKey)
  ) {
    const envId = given(environmentId)
      ? environmentId
      : fromEnv(ENVIRONMENT_ID_ENVS);
    if (envId === undefined) {
      throw new Error(
        `connectTunnel(): environmentId is required (pass the option or set ${ENVIRONMENT_ID_ENVS[1]})`
      );
    }
    if (!envId.startsWith("env_")) {
      throw new Error(
        "connectTunnel(): environmentId must be `env_` followed by alphanumerics (e.g. env_201k0yd4...)"
      );
    }
    // The key's region domain only feeds the default SRV name; with explicit
    // servers or an SRV name it is not used, so any valid domain will do.
    const regionValue = given(region) ? region : fromEnv(CLOUD_REGION_ENVS);
    const regionDomain =
      regionValue !== undefined
        ? `${regionValue}.restate.cloud`
        : given(tunnelServersSrv)
          ? tunnelServersSrv.replace(/^tunnel\./, "")
          : "restate.cloud";
    const signingKey = given(signingPublicKey)
      ? signingPublicKey
      : fromEnv(SIGNING_PUBLIC_KEY_ENVS);
    const userinfo = given(authToken)
      ? `${encodeURIComponent(authToken)}@`
      : "";
    const params =
      signingKey !== undefined
        ? `?signing-key=${encodeURIComponent(signingKey)}`
        : "";
    key = `restate://${userinfo}${envId.slice("env_".length)}.env.${regionDomain}/${params}`;
  }

  return {
    services,
    defaultServiceOptions,
    journalValueCodecProvider,
    logger: withDiagnosticHook(logger, tunnelDiagnosticLogger),
    name: tunnelName,
    key,
    connection: {
      ...tuning,
      serversSrv: tunnelServersSrv,
      servers: tunnelServers,
      workerId: tunnelWorkerId,
    },
  };
}

/**
 * The legacy raw hook saw every engine diagnostic, whatever its level. Route
 * the engine's `tunnel: …` lines to it and everything else to the given
 * transport (or the console, level by level, when none is given).
 */
function withDiagnosticHook(
  logger: LoggerTransport | undefined,
  hook: ((message: string) => void) | undefined
): LoggerTransport | undefined {
  if (hook === undefined) return logger;
  return (params, message, ...optionalParams: unknown[]) => {
    const text = String(message);
    if (text.startsWith("tunnel:")) {
      hook(text);
    } else if (logger !== undefined) {
      logger(params, message, ...optionalParams);
    } else {
      const level = String(params.level);
      /* eslint-disable no-console */
      const sink =
        level === "trace" || level === "debug"
          ? console.debug
          : level === "info"
            ? console.info
            : level === "warn"
              ? console.warn
              : console.error;
      /* eslint-enable no-console */
      sink(text, ...optionalParams);
    }
  };
}
