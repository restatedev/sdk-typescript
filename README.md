# Restate Typescript SDK

# Prerequisites

* NodeJS
* A protobuf compiler [protoc](https://grpc.io/docs/protoc-installation/)
* run `npm install`

# Building and testing the SDK
## Useful editor plugins
If you are using Visual Studio Code, install the following extensions:
* Typescript plugin by Microsoft.
* ESLint
* Prettier ESLint
* Jest

## Generating Protobuf Typescript code

```bash
npm run proto
```

## Building the SDK
```bash
npm run build
```

If everything goes well, the artifact would be created at `dist/`.

## Running the tests 

```bash
npm run test
```

## Running the linter

```bash
npm run lint
```

## Formatting the code

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
docker run -e RUST_LOG=info,restate=debug --network=host ghcr.io/restatedev/restate-dist:latest
```
- On macOS:
```shell
docker run -e RUST_LOG=info,restate=debug ghcr.io/restatedev/restate-dist:latest
```

Discover the TestGreeter:
- On Linux:
```shell
curl -X POST http://localhost:8081/services/discover -H 'content-type: application/json' -d '{"uri": "http://localhost:8000"}'
```
- On macOS:
```shell
curl -X POST http://localhost:8081/services/discover -H 'content-type: application/json' -d '{"uri": "http://host.docker.internal:8000"}'
```

Send a Greet request via curl:
```shell
curl -X POST http://localhost:9090/test.TestGreeter/Greet -H 'content-type: application/json' -d '{"name": "Pete"}'
```

# Releasing the package

Releasing a new npm package from this repo requires a GitHub personal access token in your environment as `NPM_TOKEN`.
```bash
# using 1password (https://developer.1password.com/docs/cli/shell-plugins/github/)
NPM_TOKEN="op://private/GitHub Personal Access Token/token" op run -- npm run release
# now select what type of release you want to do and say yes to the rest of the options
```
The actual `npm publish` is done by GitHub actions once a GitHub release is created.
