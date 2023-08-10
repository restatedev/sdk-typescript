# Restate Typescript SDK

[Restate](https://restate.dev/) is a system for easily building resilient applications using **distributed durable async/await**.
This repository contains the Restate SDK for writing services in Node.js / Typescript.

To use this SDK, simply add the dependency to your project (`npm install @restatedev/restate-sdk`), or
use the [Restate Node Template](https://github.com/restatedev/node-template-generator) to get started (`npx -y @restatedev/create-app`). 

Check [Restate GitHub](https://github.com/restatedev/) or the [docs](https://docs.restate.dev/) for further details.


# Contributing to the SDK

### Prerequisites
- [NodeJS (and npm)](https://nodejs.org) installed

### Building the SDK

Install the dependencies, build the protocol types (from ProtoBuf), and transpile the TypeScript code:
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
    docker run --name restate_dev --rm --network=host ghcr.io/restatedev/restate-dist:latest

    curl -X POST http://localhost:8081/endpoints -H 'content-type: application/json' -d '{"uri": "http://localhost:8080"}'
    ```
- On macOS:
    ```shell
    docker run --name restate_dev --rm -p 8081:8081 -p 9091:9091 -p 9090:9090 ghcr.io/restatedev/restate-dist:latest

    curl -X POST http://localhost:8081/endpoints -H 'content-type: application/json' -d '{"uri": "http://host.docker.internal:8080"}'
    ```


Invoke the example service from the command line:
```shell
curl -X POST http://localhost:9090/greeter/greet -H 'content-type: application/json' -d '{"name": "Pete"}'
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
2. [Update and release Lambda greeter example](https://github.com/restatedev/example-lambda-ts-greeter#upgrading-the-sdk)
3. [Update the Typescript SDK, Tour and Lambda greeter version in the documentation and release it](https://github.com/restatedev/documentation#upgrading-typescript-sdk-version)
4. [Update and release the Node template generator](https://github.com/restatedev/node-template-generator#upgrading-typescript-sdk)
5. Update the other examples:
   * [Ticket reservation example](https://github.com/restatedev/example-ticket-reservation-system#upgrading-typescript-sdk)
   * [Food ordering example](https://github.com/restatedev/example-food-ordering#upgrading-typescript-sdk)
   * [Shopping cart example](https://github.com/restatedev/example-shopping-cart-typescript#upgrading-typescript-sdk)
6. [Update the e2e tests to point to the new SDK version](https://github.com/restatedev/e2e/blob/main/services/node-services/package.json).
