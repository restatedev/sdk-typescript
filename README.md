[![Documentation](https://img.shields.io/badge/doc-reference-blue)](https://docs.restate.dev)
[![Examples](https://img.shields.io/badge/view-examples-blue)](https://github.com/restatedev/examples)
[![Discord](https://img.shields.io/discord/1128210118216007792?logo=discord)](https://discord.gg/skW3AZ6uGd)
[![Twitter](https://img.shields.io/twitter/follow/restatedev.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=restatedev)

# Restate Typescript SDK

[Restate](https://restate.dev/) is a system for easily building resilient applications using *distributed durable async/await*. This repository contains the Restate SDK for writing services in **Node.js / Typescript**.

Restate applications are composed of *durably executed, stateful RPC handlers* that can run either
as part of long-running processes, or as FaaS (AWS Lambda).

```typescript
// note that there is no failure handling in this example, because the combination of durable execution,
// communication, and state storage makes this unnecessary here.
const addToCart = async (ctx: restate.ObjectContext,  ticketId: string) => {
  // RPC participates in durable execution, so guaranteed to eventually happen and
  // will never get duplicated. would suspend if the other takes too long
  const success = await ctx.service(ticketApi).reserve(ticketId);

  if (success) {
    const cart = (await ctx.get<string[]>("cart")) || []; // gets state 'cart' bound to current cartId
    cart.push(ticketId);
    ctx.set("cart", cart);                                // writes state bound to current cartId

    // reliable delayed call sent from Restate, which also participaes in durable execution
    ctx.objectSendDelayed(cartApi, minutes(15)).expireTicket(ticketId);
  }
  return success;
}

...

restate
  .createServer()
  .object("cart", restate.object({ addToCart, expireTicket }))
  .listen(9080);
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

## Contributing

We’re excited if you join the Restate community and start contributing!
Whether it is feature requests, bug reports, ideas & feedback or PRs, we appreciate any and all contributions.
We know that your time is precious and, therefore, deeply value any effort to contribute!

### Building the SDK

#### Prerequisites
- [NodeJS (and npm)](https://nodejs.org) installed

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

### Update the proto descriptors

```shell
npm run proto
```

### Testing end-to-end with Restate Server

[Launch the Restate Server](https://github.com/restatedev/restate?tab=readme-ov-file#install-the-server) for testing your SDK changes.

Register a service with the server via the Restate CLI. 
This requires that the service is running to make the discovery succeed!

```shell
npx @restatedev/restate deployment register http://localhost:9080
```

Invoke the example service from the command line:
```shell
curl -X POST http://localhost:8080/greeter/greet -H 'content-type: application/json' -d '{"name": "Pete"}'
```

## Releasing the package

### Pre-release

Before release, make sure the `buf.lock` of the proto descriptors is updated. See [Update the proto descriptors](#update-the-proto-descriptors).

### Releasing via release-it

Releasing a new npm package from this repo requires:

* [SSH access configured for Github](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) in order to push commits and tags to GitHub
* A GitHub personal access token with access to https://github.com/restatedev/sdk-typescript in your environment as `GITHUB_TOKEN` in order to create a Github release


```bash
npm run release
# now select what type of release you want to do and say yes to the rest of the options
```

The actual `npm publish` is run by GitHub actions once a GitHub release is created.

### Releasing manually

1. Bump the version field in package.json to `X.Y.Z`
2. Create and push a tag of the form `vX.Y.Z` to the upstream repository
3. [Create a new GitHub release](https://github.com/restatedev/sdk-typescript/releases)

Creating the GitHub release will trigger `npm publish` via GitHub actions.

After having created a new SDK release, you need to:

1. [Update and release the tour of Restate](https://github.com/restatedev/tour-of-restate-typescript#upgrading-typescript-sdk)
2. [Update the Typescript SDK and Tour version in the documentation and release it](https://github.com/restatedev/documentation#upgrading-typescript-sdk-version)
3. [Update and release the Node template generator](https://github.com/restatedev/node-template-generator#upgrading-typescript-sdk)
4. [Update the examples](https://github.com/restatedev/examples#upgrading-the-sdk-dependency-for-restate-developers)
