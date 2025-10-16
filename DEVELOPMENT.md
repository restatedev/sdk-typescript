# Development guidelines

## Prerequisites
- [NodeJS (and npm)](https://nodejs.org) installed

## Building the SDK

Install the dependencies and transpile the TypeScript code:
```shell
npm install
npm run build
```

If everything goes well, the artifact would be created at `dist/`.

## Testing Changes

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
npm run -w packages/restate-sdk-examples greeter
npm run -w packages/restate-sdk-examples object
npm run -w packages/restate-sdk-examples workflow
```

## Testing end-to-end with Restate Server

E2E tests run automatically with 

## Re-generating the discovery manifest

```shell
npx --package=json-schema-to-typescript json2ts endpoint_manifest_schema.json packages/restate-sdk/src/endpoint/discovery.ts
```

## Releasing the package

### Releasing via release-it

Releasing a new npm package from this repo requires:

* [SSH access configured for Github](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) in order to push commits and tags to GitHub
* A GitHub personal access token with access to https://github.com/restatedev/sdk-typescript in your environment as `GITHUB_TOKEN` in order to create a Github release

```bash
release-it
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
