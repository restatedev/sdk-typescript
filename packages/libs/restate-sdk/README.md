[![Documentation](https://img.shields.io/badge/doc-reference-blue)](https://docs.restate.dev)
[![Examples](https://img.shields.io/badge/view-examples-blue)](https://github.com/restatedev/examples)
[![NPM Version](https://img.shields.io/npm/v/%40restatedev%2Frestate-sdk)](https://www.npmjs.com/package/@restatedev/restate-sdk)
[![Discord](https://img.shields.io/discord/1128210118216007792?logo=discord)](https://discord.gg/skW3AZ6uGd)
[![Twitter](https://img.shields.io/twitter/follow/restatedev.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=restatedev)

# Restate Typescript SDK

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*. This repository contains the Restate SDK for writing services in **Node.js / Typescript**.

Restate applications are composed of *durably executed, stateful RPC handlers* that can run either
as part of long-running processes, or as FaaS (AWS Lambda).

```typescript
import * as restate from "@restatedev/restate-sdk";

const greeter = restate.service({
    name: "greeter",
    handlers: {
        greet: async (ctx: restate.Context, name: string) => {
            return `Hello ${name}!`;
        },
    },
});

restate.serve({ services: [greeter], port: 9080 });
```

## Community

* 🤗️ [Join our online community](https://discord.gg/skW3AZ6uGd) for help, sharing feedback and talking to the community.
* 📖 [Check out our documentation](https://docs.restate.dev) to get quickly started!
* 📣 [Follow us on Twitter](https://twitter.com/restatedev) for staying up to date.
* 🙋 [Create a GitHub issue](https://github.com/restatedev/sdk-typescript/issues) for requesting a new feature or reporting a problem.
* 🏠 [Visit our GitHub org](https://github.com/restatedev) for exploring other repositories.

## Using the SDK

To use this SDK, add the dependency to your project:
```shell
npm install @restatedev/restate-sdk
```

For brand-new projects, we recommend using the [Restate Node Template](https://github.com/restatedev/node-template-generator):
```shell
npx -y @restatedev/create-app@latest
```

Check the [Quickstart](https://docs.restate.dev/get_started/quickstart) for more info.

## Versions

This library follows [Semantic Versioning](https://semver.org/).

The compatibility with Restate is described in the following table:

| Restate Server\sdk-typescript | 1.11 - 1.14 | 1.15 - 1.16 |
|-------------------------------|-------------|-------------|
| 1.5                           | ✅           | ✅           |
| 1.6                           | ✅           | ✅           |
| 1.7                           | ✅           | ✅           |

Some features require a minimum version of both Restate and the SDK:

- **`TerminalError.metadata`**: requires Restate >= 1.6 with sdk-typescript >= 1.11. Check the in-code documentation for more details.
- **`ctx.run`'s `retryPolicy` pause and `PauseError`**: requires Restate >= 1.7 with sdk-typescript >= 1.15, setting `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true` on the Restate Server. Check the in-code documentation for more details.
- **Scope and limit key**: requires Restate >= 1.7 with sdk-typescript >= 1.15