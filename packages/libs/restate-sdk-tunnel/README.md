# @restatedev/restate-sdk-tunnel

> **Moved into `@restatedev/restate-sdk`.** This package is a compatibility
> re-export and will keep working, but new code does not need it.

The in-process tunnel engine — serving a Restate SDK deployment over an
**outbound** connection to Restate Cloud, with no inbound HTTP listener — now
ships inside `@restatedev/restate-sdk` (the `/node` entry):

- `restate.serve({ services })` **connects on its own** when it finds a Restate
  Cloud environment and credential (`RESTATE_ENVIRONMENT_ID` and
  `RESTATE_AUTH_TOKEN`, in the process environment or in `./.env`, which
  `restate cloud link` writes). It listens on `PORT` otherwise. See the
  `serve()` documentation in `@restatedev/restate-sdk`.
- `connectTunnel()` is exported from `@restatedev/restate-sdk/node` for
  programmatic use, with the same options and the same `TunnelConnection`
  handle as before.

```ts
// before
import { connectTunnel } from "@restatedev/restate-sdk-tunnel";

// now — same function, same options
import { connectTunnel } from "@restatedev/restate-sdk/node";

// or just
import { serve } from "@restatedev/restate-sdk";
serve({ services: [greeter] }); // connect mode when the Cloud variables are set
```

Environment variables: the engine reads the `RESTATE_*` names
(`RESTATE_ENVIRONMENT_ID`, `RESTATE_AUTH_TOKEN`, `RESTATE_CLOUD_REGION`,
`RESTATE_SIGNING_PUBLIC_KEY`, `RESTATE_TUNNEL_NAME`) and keeps accepting the
`RESTATE_INPROC_*` names the restate-operator injects, plus
`RESTATE_INPROC_AUTH_TOKEN_FILE` for a mounted token file.

## Install

```bash
npm install @restatedev/restate-sdk
```

`@restatedev/restate-sdk-tunnel` itself only re-exports from
`@restatedev/restate-sdk`, which is its peer dependency.
