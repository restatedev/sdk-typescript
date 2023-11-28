# Restate Typescript SDK

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*. This repository contains the Restate SDK for writing services in **Node.js / Typescript**.

Restate applications are composed of *durably executed, stateful RPC handlers* that can run either
as part of long-running processes, or as FaaS (AWS Lambda).

```typescript
// note that there is no failure handling in this example, because the combination of durable execution,
// communication, and state storage makes this unnecessary here.
const addToCart = async (ctx: restate.RpcContext, cartId: string /* the key */, ticketId: string) => {
  // RPC participates in durable execution, so guaranteed to eventually happend and
  // will never get duplicated. would suspend if the other takes too long
  const success = await ctx.rpc<ticketApi>({ path: "tickets" }).reserve(ticketId);

  if (success) {
    const cart = (await ctx.get<string[]>("cart")) || []; // gets state 'cart' bound to current cartId
    cart.push(ticketId);
    ctx.set("cart", cart);                                // writes state bound to current cartId

    // reliable delayed call sent from Restate, which also participaes in durable execution
    ctx.sendDelayed<cartApi>({path: "cart"}, minutes(15)).expireTicket(ticketId);
  }
  return success;
}

...

restate
  .createServer()
  .bindKeyedRouter("cart", restate.keyedRouter({ addToCart, expireTicket }))
  .listen(9080);
```

Restate takes care of:
  - **reliable execution:** handlers will always run to completion. Intermediate failures result in re-tries
    that use the *durable execution* mechanism to recover partial progress and not duplicate already executed
    steps.
  - **suspending handlers:** long-running handlers suspend when awaiting on a promise (or when explicitly
    sleeping) and resume when that promise is resolved. Lambdas finish, services may scale down.
  - **reliable communication:** handlers communicate with *exactly-once semantics*. Restate reliably delivers
    messages and anchors both sender and receiver in the durable execution to ensure no losses or duplicates
    can happen.
  - **durable timers:** handlers can sleep (and suspend) or schedule calls for later.
  - **isolation:** handlers can be keyed, which makes Restate scheduled them to obey single-writer-per-key
    semantics.
  - **state:** keyed handlers can attach key/value state, which is eagerly pushed into handlers during
    invocation, and written back upon completion. This is particularly efficient for FaaS deployments
    (stateful serverless, yay!).
  - **observability & introspection:** Restate automatically generates Open Telemetry traces for the
    interactions between handlers and gives you a SQL shell to query the distributed state of the application.
  - **gRPC support:** Handlers may optionally be defined as gRPC services, and Restate will act as the transport
    layer for the services/clients in that case.

Check [Restate GitHub](https://github.com/restatedev/) or the [docs](https://docs.restate.dev/) for further details.

# Using the SDK

To use this SDK, simply add the dependency to your project:
```shell
npm install @restatedev/restate-sdk
```

For brand-new projects, we recommend using the [Restate Node Template](https://github.com/restatedev/node-template-generator):
```shell
npx -y @restatedev/create-app
```

# Contributing to the SDK

### Prerequisites
- [NodeJS (and npm)](https://nodejs.org) installed

### Building the SDK

Install the dependencies, build the Restate protocol types (from ProtoBuf), and transpile the TypeScript code:
```shell
npm install
npm run proto
npm run build
```

If everything goes well, the artifact would be created at `dist/`.

### Testing Changes

Run the tests via
```shell
npm run test
```

Run the formatter and linter via
```shell
npm run format
npm run lint
```

Launch a sample program (requires no build)
```shell
npm run example
```

### Testing end-to-end with Restate Runtime

This requires the [Docker Engine](https://docs.docker.com/engine/install/) to launch the Restate runtime for testing.

Start the runtime in a Docker container and tell Restate about the example service. This requires the example to be running, to make the discovery succeed!
 - On Linux:
    ```shell
    docker run --name restate_dev --rm --network=host docker.io/restatedev/restate:latest

    curl -X POST http://localhost:9070/endpoints -H 'content-type: application/json' -d '{"uri": "http://localhost:9080"}'
    ```
- On macOS:
    ```shell
    docker run --name restate_dev --rm -p 9070:9070 -p 8080:8080 docker.io/restatedev/restate:latest

    curl -X POST http://localhost:9070/endpoints -H 'content-type: application/json' -d '{"uri": "http://host.docker.internal:9080"}'
    ```


Invoke the example service from the command line:
```shell
curl -X POST http://localhost:8080/greeter/greet -H 'content-type: application/json' -d '{"name": "Pete"}'
```

# Releasing the package

## Releasing via release-it

Releasing a new npm package from this repo requires:

* [SSH access configured for Github](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) in order to push commits and tags to GitHub
* A GitHub personal access token with access to https://github.com/restatedev/sdk-typescript in your environment as `GITHUB_TOKEN` in order to create a Github release


```bash
npm run release
# now select what type of release you want to do and say yes to the rest of the options
```

The actual `npm publish` is run by GitHub actions once a GitHub release is created.

## Releasing manually

1. Bump the version field in package.json to `X.Y.Z`
2. Create and push a tag of the form `vX.Y.Z` to the upstream repository
3. [Create a new GitHub release](https://github.com/restatedev/sdk-typescript/releases)

Creating the GitHub release will trigger `npm publish` via GitHub actions.

After having created a new SDK release, you need to:

1. [Update and release the tour of Restate](https://github.com/restatedev/tour-of-restate-typescript#upgrading-typescript-sdk)
2. [Update the Typescript SDK and Tour version in the documentation and release it](https://github.com/restatedev/documentation#upgrading-typescript-sdk-version)
3. [Update and release the Node template generator](https://github.com/restatedev/node-template-generator#upgrading-typescript-sdk)
4. [Update the examples](https://github.com/restatedev/examples#upgrading-the-sdk-dependency-for-restate-developers)
