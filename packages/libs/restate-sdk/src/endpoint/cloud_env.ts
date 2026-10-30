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

// Restate Cloud settings from the environment.
// =============================================================================
//
// One name per concept, all pre-existing in the product. Resolution per input:
//
//   explicit option → RESTATE_<X> → RESTATE_INPROC_<X> → error
//
// where each environment lookup sees the process environment first and then
// `./.env`, which `serve()` / `clients.connect()` load without overriding
// (see `loadEnvFile` in restate-sdk-core). The RESTATE_INPROC_* names are the
// restate-operator contract for `tunnelMode: in-process` pods and stay
// accepted as silent fallbacks. No other names are read.

import { loadEnvFile, readEnvVar } from "@restatedev/restate-sdk-core";

/** The Cloud UI, for the register-deployment deep link. */
export const CLOUD_UI_URL = "https://cloud.restate.dev";

/** The file `serve()` and `clients.connect()` load by default. */
export const DEFAULT_ENV_FILE = ".env";

/** `env_…`: the environment to connect to. */
export const ENVIRONMENT_ID_ENVS = [
  "RESTATE_ENVIRONMENT_ID",
  "RESTATE_INPROC_ENVIRONMENT_ID",
] as const;
/** The API key (`key_…`) presented in the tunnel handshake and to the ingress. */
export const AUTH_TOKEN_ENVS = ["RESTATE_AUTH_TOKEN"] as const;
/** A file holding the API key, re-read on every reconnect (mounted Secret). */
export const AUTH_TOKEN_FILE_ENVS = ["RESTATE_INPROC_AUTH_TOKEN_FILE"] as const;
/** The Cloud region (`us`, `eu`, `<slug>.byoc`), for tunnel-server discovery. */
export const CLOUD_REGION_ENVS = [
  "RESTATE_CLOUD_REGION",
  "RESTATE_INPROC_CLOUD_REGION",
] as const;
/** A DNS SRV name for tunnel-server discovery (standalone-client name). */
export const TUNNEL_SERVERS_SRV_ENVS = ["RESTATE_TUNNEL_SERVERS_SRV"] as const;
/** Explicit, comma-separated tunnel servers (standalone-client name). */
export const TUNNEL_SERVERS_ENVS = ["RESTATE_TUNNEL_SERVERS"] as const;
/** The environment's request-identity public key (`publickeyv1_…`). */
export const SIGNING_PUBLIC_KEY_ENVS = [
  "RESTATE_SIGNING_PUBLIC_KEY",
  "RESTATE_INPROC_SIGNING_PUBLIC_KEY",
] as const;
/** The deployment name (the tunnel's identity); optional, the server mints one. */
export const TUNNEL_NAME_ENVS = [
  "RESTATE_TUNNEL_NAME",
  "RESTATE_INPROC_TUNNEL_NAME",
] as const;
/** Diagnostic worker id sent in the handshake. */
export const TUNNEL_WORKER_ID_ENVS = ["RESTATE_TUNNEL_WORKER_ID"] as const;
/** The ingress base URL, read by `clients.connect()` and echoed in the banner. */
export const INGRESS_URL_ENVS = ["RESTATE_INGRESS_URL"] as const;

/** A resolved environment value and the variable it came from. */
export interface EnvValue {
  value: string;
  name: string;
}

/** The first set, non-empty variable among `names`, in order. */
export function readEnv(names: readonly string[]): EnvValue | undefined {
  for (const name of names) {
    const value = readEnvVar(name);
    if (value !== undefined) return { value, name };
  }
  return undefined;
}

/** How to discover tunnel servers, as read from the environment. */
export type DiscoveryEnv = {
  /** The variable the value came from. */
  name: string;
} & (
  | {
      kind: "region";
      region: string;
      tunnelServersSrv?: undefined;
      tunnelServers?: undefined;
    }
  | {
      kind: "srv";
      tunnelServersSrv: string;
      region?: undefined;
      tunnelServers?: undefined;
    }
  | {
      kind: "servers";
      tunnelServers: string[];
      region?: undefined;
      tunnelServersSrv?: undefined;
    }
);

/**
 * Tunnel-server discovery from the environment:
 * `RESTATE_CLOUD_REGION` → `RESTATE_TUNNEL_SERVERS_SRV` → `RESTATE_TUNNEL_SERVERS`
 * → `RESTATE_INPROC_CLOUD_REGION`. The two standalone-client names map onto
 * the existing `tunnelServersSrv` / `tunnelServers` options (BYOC / custom).
 */
export function readDiscoveryEnv(): DiscoveryEnv | undefined {
  const region = readEnv([CLOUD_REGION_ENVS[0]]);
  if (region !== undefined) {
    return { kind: "region", region: region.value, name: region.name };
  }
  const srv = readEnv(TUNNEL_SERVERS_SRV_ENVS);
  if (srv !== undefined) {
    return { kind: "srv", tunnelServersSrv: srv.value, name: srv.name };
  }
  const servers = readEnv(TUNNEL_SERVERS_ENVS);
  if (servers !== undefined) {
    return {
      kind: "servers",
      tunnelServers: servers.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      name: servers.name,
    };
  }
  const inproc = readEnv([CLOUD_REGION_ENVS[1]]);
  if (inproc !== undefined) {
    return { kind: "region", region: inproc.value, name: inproc.name };
  }
  return undefined;
}

/** Human-readable label of the discovery target, for the startup banner. */
export function discoveryLabel(
  discovery:
    | { region?: string; tunnelServersSrv?: string; tunnelServers?: string[] }
    | DiscoveryEnv
    | undefined
): string {
  if (discovery === undefined) return "?";
  if (discovery.region !== undefined && discovery.region !== "") {
    return discovery.region;
  }
  if (
    discovery.tunnelServersSrv !== undefined &&
    discovery.tunnelServersSrv !== ""
  ) {
    return discovery.tunnelServersSrv;
  }
  if (discovery.tunnelServers !== undefined) {
    return discovery.tunnelServers.join(",");
  }
  return "?";
}

/**
 * The deployment URL to register for an in-process tunnel. Shared contract
 * with the CLI and the Cloud UI:
 *
 *   `<proxyBaseUrl>:9080/<environment id without env_>/<name>/http/in-process/9080/`
 *
 * The port is **always 9080** (the proxy), never the zone-specific port the
 * handshake's `proxy-url` trailer carries. The base is derived from the
 * discovery configuration (`https://tunnel.<region domain>` for a region, the
 * SRV host for BYOC); with explicit `tunnelServers` it falls back to the
 * trailer's host. The `/http/in-process/9080/` tail is a constant: an
 * in-process tunnel is never dialed, the server routes by the name.
 */
export function buildDeploymentUrl(args: {
  environmentId: string;
  srvName: string | undefined;
  proxyUrl: string;
  tunnelName: string;
}): string {
  const bareEnvironmentId = args.environmentId.replace(/^env_/, "");
  let base: string;
  if (args.srvName !== undefined) {
    base = `https://${args.srvName}:9080`;
  } else {
    try {
      const proxy = new URL(args.proxyUrl);
      base = `${proxy.protocol}//${proxy.hostname}:9080`;
    } catch {
      // Not a URL: the trailer already carries `<base>/<env>/<name>`.
      return `${args.proxyUrl.replace(/\/+$/, "")}/http/in-process/9080/`;
    }
  }
  return `${base}/${bareEnvironmentId}/${args.tunnelName}/http/in-process/9080/`;
}

/** The registration identifier the CLI and the Cloud UI accept. */
export function registrationIdentifier(tunnelName: string): string {
  return `tunnel://${tunnelName}`;
}

/** The Cloud UI deep link that opens the register dialog pre-filled. */
export function registrationDeepLink(tunnelName: string): string {
  return `${CLOUD_UI_URL}/to/overview?register-deployment=${registrationIdentifier(tunnelName)}`;
}

/** The outcome of {@link decideServeMode}. */
export type ServeDecision =
  | { mode: "listen"; signingPublicKey: string | undefined }
  | {
      mode: "connect";
      environmentId: string;
      /** Region or server label, for the banner. */
      discovery: string;
      /** Where the environment came from, for the banner. */
      source: string;
      ingressUrl: string | undefined;
    };

/**
 * Decide how `serve()` runs, once at startup:
 *
 * 1. Load the dotenv file (default `./.env`, never overriding, skipped with
 *    `envFile: false`).
 * 2. Explicit `mode` wins. Otherwise: environment **and** credential present →
 *    connect; neither → listen; exactly one → fail fast naming the missing
 *    variable (no silent fallback to listening).
 *
 * Environment and credential are read as the engine does: the `connect`
 * option, then `RESTATE_ENVIRONMENT_ID` / `RESTATE_AUTH_TOKEN`, then the
 * `RESTATE_INPROC_*` fallbacks (a token file counts as a credential).
 */
export function decideServeMode(args: {
  mode?: "listen" | "connect";
  connect?: {
    environmentId?: string;
    authToken?: string;
    region?: string;
    tunnelServersSrv?: string;
    tunnelServers?: string[];
  };
  envFile?: string | false;
  log: (message: string) => void;
}): ServeDecision {
  const environmentBefore = readEnv(ENVIRONMENT_ID_ENVS);
  let loadedFile: string | undefined;
  if (args.envFile !== false) {
    const file = args.envFile ?? DEFAULT_ENV_FILE;
    if (loadEnvFile(file) === "loaded") {
      loadedFile = displayPath(file);
      args.log(`loaded ${loadedFile}`);
    }
  }

  const explicitEnvironment =
    args.connect?.environmentId !== undefined &&
    args.connect.environmentId !== ""
      ? args.connect.environmentId
      : undefined;
  const environment =
    explicitEnvironment !== undefined
      ? { value: explicitEnvironment, name: "serve() options" }
      : readEnv(ENVIRONMENT_ID_ENVS);
  const credential =
    args.connect?.authToken !== undefined && args.connect.authToken !== ""
      ? { name: "serve() options" }
      : (readEnv(AUTH_TOKEN_ENVS) ?? readEnv(AUTH_TOKEN_FILE_ENVS));

  const link = `run \`restate cloud link\` to write both to ./.env`;
  if (args.mode === "listen") {
    return {
      mode: "listen",
      signingPublicKey: readEnv(SIGNING_PUBLIC_KEY_ENVS)?.value,
    };
  }
  if (
    args.mode === undefined &&
    environment === undefined &&
    credential === undefined
  ) {
    return {
      mode: "listen",
      signingPublicKey: readEnv(SIGNING_PUBLIC_KEY_ENVS)?.value,
    };
  }
  if (environment === undefined) {
    throw new Error(
      credential === undefined
        ? `serve({ mode: "connect" }) needs a Restate Cloud environment and credential: set ${ENVIRONMENT_ID_ENVS[0]} and ${AUTH_TOKEN_ENVS[0]}, or ${link}`
        : `a Restate Cloud credential is set (${credential.name}) but no environment: set ${ENVIRONMENT_ID_ENVS[0]}, or ${link}` +
            (args.mode === undefined
              ? `; pass serve({ mode: "listen" }) to ignore the Cloud settings`
              : "")
    );
  }
  if (credential === undefined) {
    throw new Error(
      `Restate Cloud environment ${environment.value} is set (${environment.name}) but no credential: set ${AUTH_TOKEN_ENVS[0]}, or ${link}` +
        (args.mode === undefined
          ? `; pass serve({ mode: "listen" }) to ignore the Cloud settings`
          : "")
    );
  }

  const source =
    explicitEnvironment !== undefined
      ? "serve() options"
      : environmentBefore === undefined && loadedFile !== undefined
        ? loadedFile
        : "the process environment";
  const explicitDiscovery =
    args.connect !== undefined &&
    (args.connect.region !== undefined ||
      args.connect.tunnelServersSrv !== undefined ||
      args.connect.tunnelServers !== undefined);
  const discovery = explicitDiscovery
    ? discoveryLabel(args.connect)
    : discoveryLabel(readDiscoveryEnv());
  return {
    mode: "connect",
    environmentId: environment.value,
    discovery,
    source,
    ingressUrl: readEnv(INGRESS_URL_ENVS)?.value,
  };
}

function displayPath(file: string): string {
  return file.startsWith("/") || file.startsWith(".") ? file : `./${file}`;
}
