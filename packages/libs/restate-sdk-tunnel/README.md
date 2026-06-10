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

const connection = connectTunnel({
  region: "us", // Restate Cloud region (tunnel servers discovered via DNS)
  environmentId: "env_...", // your environment ID (env_ prefix included)
  authToken: process.env.RESTATE_AUTH_TOKEN!, // Cloud API key with the Full role
  signingPublicKey: "publickeyv1_...", // your environment's request-identity key
  tunnelName: "greeter-v1", // the deployment's identity: unique per deployment, shared by its replicas
  services: [greeter],
});

await connection.ready;
console.log(`register me: ${connection.deploymentUrl}`);
```

Once connected, register the deployment against Restate Cloud at
`connection.deploymentUrl` —
`<proxyUrl>/http/in-process/9080/`, e.g.:

```
restate dep register https://tunnel.us.restate.cloud:9080/<unprefixed-env-id>/greeter-v1/http/in-process/9080/
                      └──────────────── connection.proxyUrl ─────────────────┘└── constant ──┘
```

Two things to know about the URL's anatomy:

- **`tunnelName` is the deployment's identity** — the tunnel server keys
  connections by `<environment>/<tunnelName>` and load-balances every
  proxied invocation across the connections registered under that key.
  Give each distinct deployment its own `tunnelName`; let replicas of the
  _same_ deployment share one (that's the HA/load-balancing path).
- **The `/http/in-process/9080/` destination is a constant** — the
  standalone tunnel client is a forwarder that dials this segment on the
  far side; an in-process tunnel terminates in this very process, so the
  destination is never dialed and plays no role. It only needs to be
  stable, because Restate identifies deployments by their full URI.

## How it works

`connectTunnel` is the in-process analog of Restate Cloud's standalone
[tunnel client](https://github.com/restatedev/restate-cloud-tunnel-client):

1. **Dial out** to the tunnel servers (region-based DNS discovery, or
   explicit `tunnelServers`) — **one connection per resolved server**, like
   the standalone client: SRV discovery expands every target to all of its
   addresses, the set is re-resolved periodically, and connections are
   started/torn down as servers appear/vanish. TLS with **ALPN `h2`** —
   the same offer the standalone Rust client makes; the negotiation must
   succeed (see the server-version note below).
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
7. **Drain gracefully:** the engine advertises `supports-drain`. When
   Restate Cloud rolls a tunnel node it sends `/_/drain-tunnel`; the engine
   immediately dials a replacement while the old connection keeps serving
   its in-flight invocations (up to `drainGraceMs`, default 120s) — zero
   dropped requests across cloud rollovers.

## API

```ts
function connectTunnel(options: ConnectTunnelOptions): TunnelConnection;

interface TunnelConnection {
  close(): Promise<void>; // stop reconnecting + close
  readonly ready: Promise<void>; // first successful handshake (rejects on fatal)
  readonly connectionCount: number;
  readonly tunnelName: string | undefined; // learned from the handshake
  readonly proxyUrl: string | undefined; // proxy base for this tunnel
  readonly deploymentUrl: string | undefined; // ready-made registration URL
  readonly tunnelUrl: string | undefined;
  readonly error: Error | undefined; // set on fatal (no more reconnects)
}
```

Key options (see `ConnectTunnelOptions` for the full surface and defaults):

| Option                                          | Meaning                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `region` / `tunnelServersSrv` / `tunnelServers` | Tunnel server discovery — exactly one; one connection per resolved server   |
| `resolveIntervalMs`                             | SRV re-resolution cadence (30s; Node hides DNS TTLs)                        |
| `environmentId`                                 | `env_...` — the environment to tunnel to                                    |
| `authToken`                                     | Cloud API key (`key_...`, Full role) presented in the handshake             |
| `signingPublicKey`                              | `publickeyv1_...` — request-identity verification (required)                |
| `tunnelName`                                    | The deployment's identity — unique per deployment, shared by its replicas   |
| `services`                                      | Same shape `restate.serve` accepts                                          |
| `tls`                                           | Default on (system trust, ALPN `h2`); object form for CA/mTLS               |
| `connectTimeoutMs`                              | TCP+TLS dial deadline (5s, mirrors the standalone client)                   |
| `reconnectInitialMs/MaxMs/Factor`               | Jittered exponential backoff (10ms → 120s, reset after a stable connection) |
| `supportsDrain` / `drainGraceMs`                | Graceful-drain handover on cloud rollovers (on, 120s grace)                 |
| `pingIntervalMs/TimeoutMs/MaxMissed`            | Liveness watchdog (75s cadence)                                             |
| `maxConcurrentStreams` etc.                     | HTTP/2 tuning for high-concurrency serving                                  |

## Install

```bash
npm install @restatedev/restate-sdk-tunnel @restatedev/restate-sdk
```

`@restatedev/restate-sdk` is a peer dependency.

## Scope and status

- Serves the deployment **in-process** — this package does not proxy to a
  separate local service, and does not expose the standalone tunnel client's
  "remote proxy" (local ingress/admin forwarding) feature.
- Multi-homed like the standalone client: one connection per resolved
  tunnel server (per IP for SRV discovery), each with its own reconnect
  loop; the server set is reconciled as DNS changes. A fatal handshake on
  any connection (`unauthorized`, `bad-tunnel-name`) stops the whole
  tunnel — the credentials are shared.
- **Requires a tunnel server with standard-h2 control traffic** (ALPN `h2`
  advertised on the tunnel listener, `:authority` on control requests).
  Older tunnel servers complete the TLS handshake without a negotiated
  protocol and are rejected by this client with a clear log message.
- Node-only (uses `node:tls`, `node:http2`, `node:dns`). Node ≥ 22.
