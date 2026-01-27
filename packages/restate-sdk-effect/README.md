[![Documentation](https://img.shields.io/badge/doc-reference-blue)](https://docs.restate.dev)
[![Examples](https://img.shields.io/badge/view-examples-blue)](https://github.com/restatedev/examples)
[![NPM Version](https://img.shields.io/npm/v/%40restatedev%2Frestate-sdk-effect)](https://www.npmjs.com/package/@restatedev/restate-sdk-effect)
[![Discord](https://img.shields.io/discord/1128210118216007792?logo=discord)](https://discord.gg/skW3AZ6uGd)
[![Twitter](https://img.shields.io/twitter/follow/restatedev.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=restatedev)

# Restate Typescript SDK Effect integration

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*.

This package contains a effect integration, allowing to define input/output models of your handlers.

```typescript
import * as restate from "@restatedev/restate-sdk";
import { serde } from "@restatedev/restate-sdk-effect";
import { Schema } from "effect";

const Greeting = Schema.Struct({
  name: Schema.String
});

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: restate.handlers.handler(
      {
        input: serde.effect(Greeting),
        output: serde.effect(Schema.String),
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
npm install --save-dev @restatedev/restate-sdk-effect
```

## Versions

This library follows [Semantic Versioning](https://semver.org/).
