# @restatedev/restate-sdk-tunnel

> **Deprecated.** Connecting to Restate Cloud is built into
> `@restatedev/restate-sdk` as `connect()`. This package is a compatibility
> re-export of the old `connectTunnel()` and keeps working, but new code does
> not need it.

```ts
// before
import { connectTunnel } from "@restatedev/restate-sdk-tunnel";
connectTunnel({
  region: "eu",
  environmentId: "env_...",
  authToken: process.env.RESTATE_AUTH_TOKEN!,
  signingPublicKey: "publickeyv1_...",
  tunnelName: "greeter-v1",
  services: [greeter],
});

// now
import * as restate from "@restatedev/restate-sdk";
restate.connect({ services: [greeter], name: "greeter-v1" });
```

`connect()` takes the credential and every coordinate from one variable,
`RESTATE_CONNECT_KEY`, created in the Cloud UI under Development → Configure
SDK; the deployment name comes from the `name` option or `RESTATE_CONNECT_NAME`.
The expanded variables (`RESTATE_ENVIRONMENT_ID`, `RESTATE_AUTH_TOKEN` or
`RESTATE_INPROC_AUTH_TOKEN_FILE`, `RESTATE_CLOUD_REGION`,
`RESTATE_SIGNING_PUBLIC_KEY`, and the `RESTATE_INPROC_*` names the
restate-operator injects) stay accepted when no key is set, so existing
deployments keep working unchanged.

This package is the only place `connectTunnel()` lives on, with its previous
options and handle; it logs a deprecation warning once per process.

## Install

```bash
npm install @restatedev/restate-sdk
```
