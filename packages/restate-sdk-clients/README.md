[![Documentation](https://img.shields.io/badge/doc-reference-blue)](https://docs.restate.dev)
[![Examples](https://img.shields.io/badge/view-examples-blue)](https://github.com/restatedev/examples)
[![Discord](https://img.shields.io/discord/1128210118216007792?logo=discord)](https://discord.gg/skW3AZ6uGd)
[![Twitter](https://img.shields.io/twitter/follow/restatedev.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=restatedev)

# Restate Typescript SDK Clients

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*.

This package contains the clients to interact with your Restate services, using `fetch`. 

```typescript
import * as restate from "@restatedev/restate-sdk-clients";

// Import the type of the service to call
import type { Greeter } from "./greeter-service";
const Greeter: Greeter = { name: "greeter" };

// Instantiate the Restate client
const rs = restate.connect({ url: "http://localhost:8080" });

// Get a typed client for Greeter
const greeter = rs.serviceClient(Greeter);

// Send a request to greet
const greeting = await greeter.greet(name);
```

## Community

* 🤗️ [Join our online community](https://discord.gg/skW3AZ6uGd) for help, sharing feedback and talking to the community.
* 📖 [Check out our documentation](https://docs.restate.dev) to get quickly started!
* 📣 [Follow us on Twitter](https://twitter.com/restatedev) for staying up to date.
* 🙋 [Create a GitHub issue](https://github.com/restatedev/sdk-typescript/issues) for requesting a new feature or reporting a problem.
* 🏠 [Visit our GitHub org](https://github.com/restatedev) for exploring other repositories.

## Using the SDK

To use this client, add the dependency to your project:

```shell
npm install @restatedev/restate-sdk-clients
```

## Versions

This library follows [Semantic Versioning](https://semver.org/).