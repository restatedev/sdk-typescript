# Restate Typescript SDK

This repository contains the Restate SDK for writing services in Typescript. 

Restate is a system for easily building resilient applications using **distributed durable RPC & async/await**.

❓ Learn more about Restate from the [Restate documentation](https://github.com/restatedev/documentation).

# Prerequisites
- [NodeJS (and npm)](https://nodejs.org) installed.
- [Docker Engine](https://docs.docker.com/engine/install/) to launch the Restate runtime (not needed for the app implementation itself).

# Building the SDK
Install the NodeJS dependencies:
```shell
npm install
```

Generate the Protobuf definitions for the Restate protocol: 
```bash
npm run proto
```

Build the SDK:
```bash
npm run build
```

If everything goes well, the artifact would be created at `dist/`.

## Testing the SDK
You can run the tests via:

```bash
npm run test
```

## Linter / formatter
Run the linter with:
```bash
npm run lint
```

Format the code with:
```bash
npm run format
```

## Running the example during development
An example of a long-running service and a Lambda handler have been implemented in the `examples` folder.
These are included to have a quick implement-test cycle during develpment.

To run the example:

```bash
npm run example
```

You can also produce the final artifiact by `npm run build`, and then you can manually run

```bash
node dist/example.js
```

(Please note the `.js` and not `.ts` as the `build` process will translate the TypeScript files back to .Js files)


Start the runtime in a Docker container:
- On Linux:
```shell
docker run --name restate_dev --rm --network=host ghcr.io/restatedev/restate-dist:0.1.2
```
- On macOS:
```shell
docker run --name restate_dev --rm -p 8081:8081 -p 9091:9091 -p 9090:9090 ghcr.io/restatedev/restate-dist:0.1.2
```

Discover the TestGreeter:
- On Linux:
```shell
curl -X POST http://localhost:8081/endpoints -H 'content-type: application/json' -d '{"uri": "http://localhost:8080"}'
```
- On macOS:
```shell
curl -X POST http://localhost:8081/endpoints -H 'content-type: application/json' -d '{"uri": "http://host.docker.internal:8080"}'
```

Send a Greet request via curl:
```shell
curl -X POST http://localhost:9090/test.TestGreeter/Greet -H 'content-type: application/json' -d '{"name": "Pete"}'
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
2. [Update the Typescript SDK and Tour version and release the documentation](https://github.com/restatedev/documentation#upgrading-typescript-sdk-version)
3. [Update and release the Node template generator](https://github.com/restatedev/node-template-generator#upgrading-typescript-sdk)
4. Update the examples:
   * [Ticket reservation example](https://github.com/restatedev/example-ticket-reservation-system#upgrading-typescript-sdk)
   * [Food ordering example](https://github.com/restatedev/example-food-ordering#upgrading-typescript-sdk)
   * [Shopping cart example](https://github.com/restatedev/example-shopping-cart-typescript#upgrading-typescript-sdk)
   * [Lambda greeter example](https://github.com/restatedev/example-lambda-ts-greeter#upgrading-the-sdk)
5. Update the e2e tests to point to the new SDK version.
