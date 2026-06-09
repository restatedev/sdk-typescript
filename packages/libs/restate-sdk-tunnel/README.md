# @restatedev/restate-sdk-tunnel

Serve a Restate SDK deployment over an **outbound** connection to Restate
Cloud's tunnel — no inbound HTTP listener, no public ingress into your
network. A drop-in alternative to binding a listener with `restate.serve(...)`
for deployments running in private networks.

```ts
import * as restate from "@restatedev/restate-sdk";
import { connectTunnel } from "@restatedev/restate-sdk-tunnel";

const greeter = restate.service({
  name: "greeter",
  handlers: { greet: async (_ctx, name: string) => `Hello ${name}!` },
});

connectTunnel({
  region: "us", // Restate Cloud region (tunnel servers discovered via DNS)
  environmentId: "env_...", // your environment ID (env_ prefix included)
  authToken: process.env.RESTATE_AUTH_TOKEN!, // Cloud API key with the Full role
  signingPublicKey: "publickeyv1_...", // your environment's request-identity key
  tunnelName: "my-cluster", // stable rendezvous name for this deployment
  services: [greeter],
});
```

Once connected, register the deployment against Restate Cloud. The
registration URL is the tunnel's proxy **base** URL (`connection.proxyUrl`,
learned during the handshake — `<proxy-host>/<env-id>/<tunnel-name>`) plus a
`/<scheme>/<host>/<port>` destination segment; for an in-process deployment
the destination is vestigial:

```
restate dep register https://tunnel.us.restate.cloud:9080/<unprefixed-env-id>/my-cluster/http/in-process/9080
                      └──────────────── connection.proxyUrl ───────────────┘└── destination ──┘
```

## How it works

`connectTunnel` is the in-process analog of Restate Cloud's standalone
[tunnel client](https://github.com/restatedev/restate-cloud-tunnel-client):

1. **Dial out** to a tunnel server (region-based DNS discovery, or explicit
   `tunnelServers`). TLS, deliberately with **no ALPN** — the tunnel speaks
   HTTP/2 with prior knowledge.
2. **Role-flip:** Restate Cloud drives HTTP/2 as the _client_ over the
   connection we dialed; the deployment becomes the HTTP/2 _server_ on it.
3. **Handshake:** the cloud opens `GET /_/start-tunnel`; we answer with the
   environment credentials and receive the tunnel confirmation (including
   the public `proxy-url`) as HTTP/2 trailers.
4. **Serve:** each invocation arrives as one HTTP/2 stream. The tunnel's
   `/<scheme>/<host>/<port>` destination prefix is stripped and the request
   is handed to the SDK's own endpoint handler (full-duplex streaming —
   `BIDI_STREAM`), exactly as if it had arrived on a local listener.
5. **Verify:** every forwarded request carries Restate's request-identity
   JWT (`x-restate-jwt-v1`). Verification is delegated to the SDK against
   `signingPublicKey`, so only requests signed by _your_ environment are
   served.
6. **Reconnect** on disconnect with jittered exponential backoff.
   Authorization failures (`unauthorized`, `bad-tunnel-name`) are **fatal**
   — they surface on `connection.error` / `connection.ready` instead of
   hammering the auth path.

## API

```ts
function connectTunnel(options: ConnectTunnelOptions): TunnelConnection;

interface TunnelConnection {
  close(): Promise<void>; // stop reconnecting + close
  readonly ready: Promise<void>; // first successful handshake (rejects on fatal)
  readonly connectionCount: number;
  readonly tunnelName: string | undefined; // learned from the handshake
  readonly proxyUrl: string | undefined; // where to register the deployment
  readonly tunnelUrl: string | undefined;
  readonly error: Error | undefined; // set on fatal (no more reconnects)
}
```

Key options (see `ConnectTunnelOptions` for the full surface and defaults):

| Option                               | Meaning                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `region` _or_ `tunnelServers`        | Tunnel server discovery — exactly one of the two                            |
| `environmentId`                      | `env_...` — the environment to tunnel to                                    |
| `authToken`                          | Cloud API key (`key_...`, Full role) presented in the handshake             |
| `signingPublicKey`                   | `publickeyv1_...` — request-identity verification (required)                |
| `tunnelName`                         | Stable rendezvous name (appears in the registration URL)                    |
| `services`                           | Same shape `restate.serve` accepts                                          |
| `tls`                                | Default on (system trust, **no ALPN**); object form for CA/mTLS             |
| `connectTimeoutMs`                   | TCP+TLS dial deadline (5s, mirrors the standalone client)                   |
| `reconnectInitialMs/MaxMs/Factor`    | Jittered exponential backoff (10ms → 120s, reset after a stable connection) |
| `pingIntervalMs/TimeoutMs/MaxMissed` | Liveness watchdog (75s cadence)                                             |
| `maxConcurrentStreams` etc.          | HTTP/2 tuning for high-concurrency serving                                  |

## Install

```bash
npm install @restatedev/restate-sdk-tunnel @restatedev/restate-sdk
```

`@restatedev/restate-sdk` is a peer dependency.

## Scope and status

- Serves the deployment **in-process** — this package does not proxy to a
  separate local service, and does not expose the standalone tunnel client's
  "remote proxy" (local ingress/admin forwarding) feature.
- Holds a single tunnel connection; redials rotate across the resolved
  tunnel servers. Multi-homed connections and graceful drain
  (`supports-drain`) are intentionally not yet implemented.
- Node-only (uses `node:tls`, `node:http2`, `node:dns`). Node ≥ 22.
