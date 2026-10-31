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

// Resolving the identity of a connected deployment.
// =============================================================================
//
// Two inputs, read from the options and then the process environment (never a
// file; the SDK reads `process.env` only):
//
//   name  option → RESTATE_CONNECT_NAME → RESTATE_INPROC_TUNNEL_NAME
//                → RESTATE_TUNNEL_NAME → error
//   key   option → RESTATE_CONNECT_KEY → the expanded variables → error
//
// The key is one URL-shaped string from the Cloud UI (Development → Configure
// SDK), see `parseCloudKey` in restate-sdk-core. The expanded variables are
// the older spelling of the same coordinates, kept for the restate-operator
// (`RESTATE_INPROC_*`) and the standalone tunnel container (`RESTATE_*`):
// environment id, token or token file, region or SRV / servers, signing key.

import * as fs from "node:fs";
import { parseCloudKey, type CloudKey } from "./key.js";
import {
  requireHeaderSafe,
  srvNameForRegionDomain,
} from "../tunnel/options.js";
import type { EngineOptions } from "../tunnel/types.js";

/** The Cloud UI, for the deep links below. */
export const CLOUD_UI_URL = "https://cloud.restate.dev";
/** Where to get a connect key (Development → Configure SDK), linked in every error. */
export const CONNECT_KEY_URL = `${CLOUD_UI_URL}/to/developers/integration#configure-sdk`;

/** The deployment name, in resolution order. */
export const CONNECT_NAME_ENVS = [
  "RESTATE_CONNECT_NAME",
  "RESTATE_INPROC_TUNNEL_NAME",
  "RESTATE_TUNNEL_NAME",
] as const;
/** The connect key. */
export const CONNECT_KEY_ENV = "RESTATE_CONNECT_KEY";

// The expanded variables, each in resolution order.
export const ENVIRONMENT_ID_ENVS = [
  "RESTATE_ENVIRONMENT_ID",
  "RESTATE_INPROC_ENVIRONMENT_ID",
] as const;
export const AUTH_TOKEN_ENVS = ["RESTATE_AUTH_TOKEN"] as const;
/** A file holding the token, re-read on every reconnect (a mounted Secret). */
export const AUTH_TOKEN_FILE_ENVS = ["RESTATE_INPROC_AUTH_TOKEN_FILE"] as const;
export const CLOUD_REGION_ENVS = [
  "RESTATE_CLOUD_REGION",
  "RESTATE_INPROC_CLOUD_REGION",
] as const;
export const TUNNEL_SERVERS_SRV_ENVS = ["RESTATE_TUNNEL_SERVERS_SRV"] as const;
export const TUNNEL_SERVERS_ENVS = ["RESTATE_TUNNEL_SERVERS"] as const;
export const SIGNING_PUBLIC_KEY_ENVS = [
  "RESTATE_SIGNING_PUBLIC_KEY",
  "RESTATE_INPROC_SIGNING_PUBLIC_KEY",
] as const;

/** The query parameters a connect key may carry; anything else is ignored with a warning. */
const KNOWN_KEY_PARAMS = ["signing-key", "tunnel-srv", "tunnel-servers"];

/** An env var set to the empty string is treated as unset. */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** The first set variable among `names`, with its name. */
function readFirstEnv(
  names: readonly string[]
): { value: string; name: string } | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value !== undefined) return { value, name };
  }
  return undefined;
}

function given(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * The deployment name: option → `RESTATE_CONNECT_NAME` →
 * `RESTATE_INPROC_TUNNEL_NAME` → `RESTATE_TUNNEL_NAME` → error. No inference:
 * an unnamed deployment is a mistake, and the error says what to set.
 */
export function resolveName(option: string | undefined): string {
  const name = given(option) ? option : readFirstEnv(CONNECT_NAME_ENVS)?.value;
  if (name === undefined) {
    throw new Error(
      `connect(): the deployment needs a name — pass { name: "greeter-v1" } or set ${CONNECT_NAME_ENVS[0]}. Replicas of one deployment share the name; it is what you register (connect://<name>).`
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      `connect(): invalid deployment name ${JSON.stringify(name)} — use letters, digits, '.', '_' or '-'`
    );
  }
  return name;
}

/** The resolved coordinates: everything but the name and the tuning. */
export type Coordinates = Pick<
  EngineOptions,
  "environmentId" | "authToken" | "identityKeys" | "discovery"
> & {
  /** For the banner: the region domain, or what stands in for it. */
  regionLabel: string;
};

/** Discovery overrides from the options (at most one). */
export interface DiscoveryOverrides {
  serversSrv?: string;
  servers?: string[];
}

/**
 * The coordinates for `connect()`: `key` option → `RESTATE_CONNECT_KEY` →
 * the expanded variables → error naming the variable and the Cloud UI page.
 * Explicit `identityKeys` and discovery options win over the key's.
 */
export function resolveCoordinates(
  options: {
    key?: string;
    identityKeys?: string[];
  } & DiscoveryOverrides,
  warn: (message: string) => void
): Coordinates {
  if (given(options.key)) {
    return coordinatesFromKey(
      parseCloudKey(options.key, "the `key` option", CONNECT_KEY_URL),
      options,
      warn
    );
  }
  const fromEnv = readEnv(CONNECT_KEY_ENV);
  if (fromEnv !== undefined) {
    return coordinatesFromKey(
      parseCloudKey(fromEnv, CONNECT_KEY_ENV, CONNECT_KEY_URL),
      options,
      warn
    );
  }
  if (readFirstEnv(ENVIRONMENT_ID_ENVS) === undefined) {
    throw new Error(
      `connect(): no Restate Cloud connect key — set ${CONNECT_KEY_ENV} (create one at ${CONNECT_KEY_URL}) or pass { key }`
    );
  }
  return coordinatesFromExpanded(options);
}

function coordinatesFromKey(
  key: CloudKey,
  options: { identityKeys?: string[] } & DiscoveryOverrides,
  warn: (message: string) => void
): Coordinates {
  const params = new Map<string, string>();
  const unknown: string[] = [];
  for (const [name, value] of key.params) {
    if (KNOWN_KEY_PARAMS.includes(name)) params.set(name, value);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    warn(
      `connect(): ignoring unknown connect key parameter(s) ${unknown.map((n) => JSON.stringify(n)).join(", ")} — this SDK version knows ${KNOWN_KEY_PARAMS.join(", ")}`
    );
  }

  // A key for one environment next to an operator's variables for another
  // is almost certainly a stray developer key: say so.
  const injected = readFirstEnv(ENVIRONMENT_ID_ENVS);
  if (injected !== undefined && injected.value !== key.environmentId) {
    warn(
      `connect(): the connect key is for environment ${key.environmentId} but ${injected.name} is set to ${injected.value}; the key wins`
    );
  }

  const identityKeys = resolveIdentityKeys(
    options.identityKeys,
    params.get("signing-key"),
    `the connect key has no signing-key parameter and no identityKeys were given — copy the key again from ${CONNECT_KEY_URL}`
  );

  const authToken =
    key.apiKey !== undefined
      ? constantToken(key.apiKey, "the connect key's API key")
      : (tokenFromEnv() ??
        fail(
          `the connect key carries no API key (restate://<api key>@…) and no token is configured in ${AUTH_TOKEN_ENVS[0]} or a file in ${AUTH_TOKEN_FILE_ENVS[0]}`
        ));

  const keyServers = params.get("tunnel-servers");
  if (keyServers !== undefined && splitList(keyServers).length === 0) {
    fail("the connect key's tunnel-servers parameter is empty");
  }
  const keySrv = params.get("tunnel-srv");
  if (keySrv === "") fail("the connect key's tunnel-srv parameter is empty");
  if (keySrv !== undefined && keyServers !== undefined) {
    fail(
      "the connect key carries both tunnel-srv and tunnel-servers; it may carry one"
    );
  }
  const keyDiscovery: DiscoveryOverrides = {
    serversSrv: keySrv,
    servers: keyServers === undefined ? undefined : splitList(keyServers),
  };
  const override = pickDiscovery(options);
  const discovery =
    override ??
    pickDiscovery(keyDiscovery) ??
    ({ srvName: srvNameForRegionDomain(key.regionDomain) } as const);

  return {
    environmentId: key.environmentId,
    authToken,
    identityKeys,
    discovery,
    regionLabel:
      override === undefined && pickDiscovery(keyDiscovery) === undefined
        ? key.regionDomain
        : discoveryLabel(discovery),
  };
}

/**
 * The coordinates from the expanded variables (`RESTATE_<X>`, then
 * `RESTATE_INPROC_<X>`), each missing piece an error naming its variable.
 * Explicit `identityKeys` and discovery options win over the environment.
 */
export function coordinatesFromExpanded(
  o: DiscoveryOverrides & { identityKeys?: string[] }
): Coordinates {
  const environmentId = requireHeaderSafe(
    readFirstEnv(ENVIRONMENT_ID_ENVS)?.value ??
      fail(
        `environmentId is required — set ${ENVIRONMENT_ID_ENVS[0]} (or ${CONNECT_KEY_ENV} from ${CONNECT_KEY_URL})`
      ),
    "environmentId"
  );
  if (!/^env_[A-Za-z0-9_-]+$/.test(environmentId)) {
    throw new Error(
      `connect(): environmentId must be \`env_\` followed by alphanumerics (e.g. env_201k0yd4...), got ${JSON.stringify(environmentId)}`
    );
  }

  const authToken =
    tokenFromEnv() ??
    fail(
      `authToken is required — set ${AUTH_TOKEN_ENVS[0]} or a token file in ${AUTH_TOKEN_FILE_ENVS[0]} (or ${CONNECT_KEY_ENV} from ${CONNECT_KEY_URL})`
    );

  const identityKeys = resolveIdentityKeys(
    o.identityKeys,
    readFirstEnv(SIGNING_PUBLIC_KEY_ENVS)?.value,
    `signingPublicKey is required — set ${SIGNING_PUBLIC_KEY_ENVS[0]} (or ${CONNECT_KEY_ENV} from ${CONNECT_KEY_URL})`
  );

  // Discovery: the options, else the environment: RESTATE_CLOUD_REGION →
  // RESTATE_TUNNEL_SERVERS_SRV → RESTATE_TUNNEL_SERVERS →
  // RESTATE_INPROC_CLOUD_REGION.
  let discovery = pickDiscovery(o);
  let regionLabel: string | undefined;
  if (discovery === undefined) {
    const region = readEnv(CLOUD_REGION_ENVS[0]);
    const srv = readFirstEnv(TUNNEL_SERVERS_SRV_ENVS)?.value;
    const servers = readFirstEnv(TUNNEL_SERVERS_ENVS)?.value;
    const inproc = readEnv(CLOUD_REGION_ENVS[1]);
    if (region !== undefined || (srv === undefined && servers === undefined)) {
      const value = region ?? inproc;
      if (value === undefined) {
        throw new Error(
          `connect(): no Restate Cloud region — set ${CLOUD_REGION_ENVS[0]} (or ${CONNECT_KEY_ENV} from ${CONNECT_KEY_URL})`
        );
      }
      const domain = regionDomainForRegion(value);
      discovery = { srvName: srvNameForRegionDomain(domain) };
      regionLabel = domain;
    } else if (srv !== undefined) {
      discovery = { srvName: srv };
    } else {
      discovery = { servers: splitList(servers!) };
    }
  }

  return {
    environmentId,
    authToken,
    identityKeys,
    discovery,
    regionLabel: regionLabel ?? discoveryLabel(discovery),
  };
}

function fail(message: string): never {
  throw new Error(`connect(): ${message}`);
}

function resolveIdentityKeys(
  option: string[] | undefined,
  signingKey: string | undefined,
  missing: string
): string[] {
  if (option !== undefined && option.length > 0) return option;
  if (signingKey === undefined) fail(missing);
  if (!signingKey.startsWith("publickeyv1_")) {
    fail(
      `the signing key must be a request-identity public key (publickeyv1_...), got ${JSON.stringify(signingKey)}`
    );
  }
  return [signingKey];
}

function constantToken(token: string, what: string): () => string {
  requireHeaderSafe(token, what);
  return () => token;
}

/** `RESTATE_AUTH_TOKEN`, then the file named by `RESTATE_INPROC_AUTH_TOKEN_FILE`. */
function tokenFromEnv(): (() => string) | undefined {
  const token = readFirstEnv(AUTH_TOKEN_ENVS);
  if (token !== undefined) return constantToken(token.value, token.name);
  const file = readFirstEnv(AUTH_TOKEN_FILE_ENVS);
  if (file === undefined) return undefined;
  const tokenFile = file.value;
  const readToken = () => {
    // Guard before reading: this runs synchronously on the redial path, so a
    // FIFO (blocks forever) or an unbounded device file (reads forever) would
    // freeze the event loop — and with it every other live connection.
    const stat = fs.statSync(tokenFile);
    if (!stat.isFile()) {
      throw new Error(
        `connect(): token file ${tokenFile} (${file.name}) is not a regular file`
      );
    }
    if (stat.size > 64 * 1024) {
      throw new Error(
        `connect(): token file ${tokenFile} (${file.name}) is implausibly large for a token (${stat.size} bytes)`
      );
    }
    // Trimmed because mounted secrets routinely carry a trailing newline.
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (token === "") {
      throw new Error(
        `connect(): token file ${tokenFile} (${file.name}) is empty`
      );
    }
    return requireHeaderSafe(token, `token file ${tokenFile}`);
  };
  // A bad path or token must throw at configuration time like every other
  // misconfiguration, not look like a transient failure mid-redial.
  readToken();
  return readToken;
}

function pickDiscovery(
  o: DiscoveryOverrides
): EngineOptions["discovery"] | undefined {
  if (given(o.serversSrv) && o.servers !== undefined) {
    throw new Error(
      "connect(): specify at most one of `serversSrv` and `servers`"
    );
  }
  if (given(o.serversSrv)) return { srvName: o.serversSrv };
  if (o.servers !== undefined) {
    if (o.servers.length === 0) {
      throw new Error("connect(): `servers` must not be empty");
    }
    return { servers: o.servers };
  }
  return undefined;
}

/** A region (`us`, `eu`, `<slug>.byoc`) is the labels before `.restate.cloud`. */
function regionDomainForRegion(region: string): string {
  // Each label lowercase [a-z0-9-], dot-separated, no empty labels.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(region)) {
    throw new Error(`connect(): invalid region ${JSON.stringify(region)}`);
  }
  return `${region}.restate.cloud`;
}

/** Human-readable discovery target for the banner. */
function discoveryLabel(discovery: EngineOptions["discovery"]): string {
  if ("srvName" in discovery) {
    return discovery.srvName.replace(/^tunnel\./, "");
  }
  return discovery.servers.join(",");
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The registration identifier the CLI and the Cloud UI accept. */
export function registrationIdentifier(name: string): string {
  return `connect://${name}`;
}

/** The Cloud UI deep link that opens the register dialog pre-filled. */
export function registrationDeepLink(name: string): string {
  return `${CLOUD_UI_URL}/to/overview?register-deployment=${registrationIdentifier(name)}`;
}
