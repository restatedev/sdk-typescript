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

// @restatedev/restate-sdk-tunnel-native
//
// Serve a Restate SDK deployment as a relay *receiver*, using the embedded
// native engine (restate-sdk-shared-core, `tunnel` feature) via napi. The
// engine dials the relay on its own tokio runtime and bridges each forwarded
// request over a loopback socket into a local node:http2 server, so SDK request
// dispatch — and therefore BOTH the codegen SDK and the promise API — is
// untouched. The napi boundary is control-plane only (start/status/stop).
//
//   import { serveTunnel } from "@restatedev/restate-sdk-tunnel-native";
//
//   const tunnel = await serveTunnel({
//     services: [greeter],
//     relay: {
//       address: "relay.example:8080",
//       env: "myenv",
//       tunnel: "mytunnel",
//       apiKey: process.env.RELAY_API_KEY!,
//     },
//   });
//
// Node-only; requires a prebuilt native addon for the host platform.

import * as http2 from "node:http2";
import {
  createEndpointHandler,
  type NodeEndpointOptions,
} from "@restatedev/restate-sdk/node";
import { RelayTunnel } from "../index.cjs";

/** Where and how to register with the relay. */
export interface RelayConnectOptions {
  /** `host:port` of the relay's receiver port (or the LB in front of it). */
  address: string;
  /** The env (routing namespace) to register under. */
  env: string;
  /** The tunnel to register under (scoped by `env`). */
  tunnel: string;
  /** The API key presented in the `/whoami` handshake. */
  apiKey: string;
  /**
   * R4 multi-homing: how many connection slots to fan out across the relay
   * nodes `address` resolves to. Omit for one per resolved node.
   */
  connections?: number;
  /**
   * R5 receiver-instance id (affinity), held across reconnects. Omit to
   * auto-generate an ephemeral, process-unique id.
   */
  instanceId?: string;
}

/**
 * Options for {@link serveTunnel}. Extends the standard node endpoint options —
 * `services`, `identityKeys`, etc. — so it accepts services from both the
 * codegen SDK and the default promise API exactly like `serve(...)`, plus the
 * relay connection coordinates.
 */
export interface ServeTunnelOptions extends NodeEndpointOptions {
  relay: RelayConnectOptions;
}

/** A snapshot of the tunnel's runtime status. */
export interface TunnelStatus {
  running: boolean;
  lastError: string | null;
}

/** A running tunnel + its private loopback server. */
export interface TunnelHandle {
  /** The loopback port the local server is bound to (127.0.0.1). */
  readonly localPort: number;
  /** Current engine status. */
  status(): TunnelStatus;
  /** Stop the tunnel (graceful) and close the loopback server. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Boot a loopback-private node:http2 (h2c) server for the given services and
 * start a relay tunnel pointed at it. Resolves once the local server is bound
 * and the tunnel engine has started; the receiver dials the relay in the
 * background.
 */
export async function serveTunnel(
  options: ServeTunnelOptions
): Promise<TunnelHandle> {
  const { relay, ...endpointOptions } = options;

  // The same dispatch handler `serve(...)` uses — unchanged for either API.
  const handler = createEndpointHandler(endpointOptions);
  // Bind 127.0.0.1 only (loopback-private): the relay reaches this server only
  // through the native engine's loopback dial, never over the network.
  const server = http2.createServer(handler);

  const localPort = await new Promise<number>((resolve, reject) => {
    const onError = (e: Error) => {
      server.close();
      reject(e);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        server.close();
        reject(new Error("relay tunnel: failed to bind the loopback server"));
      }
    });
  });

  let tunnel: RelayTunnel;
  try {
    tunnel = RelayTunnel.start(
      JSON.stringify({
        relay_addr: relay.address,
        env: relay.env,
        tunnel: relay.tunnel,
        api_key: relay.apiKey,
        local_port: localPort,
        // undefined keys are dropped by JSON.stringify → the engine treats them
        // as absent (serde `Option::None`).
        connections: relay.connections,
        instance_id: relay.instanceId,
      })
    );
  } catch (e) {
    await new Promise<void>((res) => server.close(() => res()));
    throw e;
  }

  return {
    localPort,
    status(): TunnelStatus {
      const raw = JSON.parse(tunnel.status()) as {
        running?: boolean;
        last_error?: string | null;
      };
      return {
        running: raw.running ?? false,
        lastError: raw.last_error ?? null,
      };
    },
    async stop(): Promise<void> {
      tunnel.stop();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
