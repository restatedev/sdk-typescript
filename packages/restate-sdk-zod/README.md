[![Documentation](https://img.shields.io/badge/doc-reference-blue)](https://docs.restate.dev)
[![Examples](https://img.shields.io/badge/view-examples-blue)](https://github.com/restatedev/examples)
[![NPM Version](https://img.shields.io/npm/v/%40restatedev%2Frestate-sdk-zod)](https://www.npmjs.com/package/@restatedev/restate-sdk-zod)
[![Discord](https://img.shields.io/discord/1128210118216007792?logo=discord)](https://discord.gg/skW3AZ6uGd)
[![Twitter](https://img.shields.io/twitter/follow/restatedev.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=restatedev)

# Restate Typescript SDK Zod integration

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*.

This package contains a zod integration, allowing to define input/output models of your handlers.

```typescript
import * as restate from "@restatedev/restate-sdk";
import { serde } from "@restatedev/restate-sdk-zod";
import { z } from "zod";

const Greeting = z.object({
  name: z.string(),
});

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: restate.handlers.handler(
      {
        input: serde.zod(Greeting),
        output: serde.zod(z.string()),
      },
      async (ctx, greeting) => {
        return `Hello ${greeting.name}!`;
      }
    ),
  },
});

export type Greeter = typeof greeter;

restate.serve({ services: [greeter], port: 9080 });
```

For the SDK main package, checkout [`@restatedev/restate-sdk`](../restate-sdk).

## Community

* 🤗️ [Join our online community](https://discord.gg/skW3AZ6uGd) for help, sharing feedback and talking to the community.
* 📖 [Check out our documentation](https://docs.restate.dev) to get quickly started!
* 📣 [Follow us on Twitter](https://twitter.com/restatedev) for staying up to date.
* 🙋 [Create a GitHub issue](https://github.com/restatedev/sdk-typescript/issues) for requesting a new feature or reporting a problem.
* 🏠 [Visit our GitHub org](https://github.com/restatedev) for exploring other repositories.

## Using the library

To use this library, add the dependency to your project:

```shell
npm install --save-dev @restatedev/restate-sdk-zod
npm install zod # optional if zod isn't already installed
```

# Zod v3 Users
As a minimum requirement, `zod` must be at `v3.25.0`. Also, `zod-to-json-schema` is required.
Add the following additional dependencies to your project:

```shell
npm install zod-to-json-schema zod@^3.25.0
```

## Versions

This library follows [Semantic Versioning](https://semver.org/).
