### TypeScript SDK PoC 

#### Prerequisites

* A reletivily recent NodeJs installed.
* A protobuf compiler [protoc](https://grpc.io/docs/protoc-installation/)
* run `npm install`

#### Generate Protobufs

```bash
npm run proto
```

#### build
```bash
npm run build
```

If everything goes well, the artifact would be created at `dist/`.


#### test

```bash
npm run test
```

#### run a linter

```bash
npm run lint
```

#### run a code foramtter

```bash
npm run format
```

#### Editor support

If you are using `vscode`, install the following extentions:
* Typescript plugin by Microsoft.
* ESLint
* Prettier ESLint
* Jest


#### Run the example file

Since this project final artifact is a node package that others would import in their projects,
interactive development might be a bit tedious, so as a temporary productivity boost I've added an `example.ts`
that is going to be built as part of this artifact _for now_.

To run the example type:

```bash
npm run example
```

Try it out using CURL 

```bash
curl -v --http2-prior-knowledge -d '' localhost:8000/dev.restate.Greeter/Greet
```

You can also, produce the final artifiact by `npm run build`, and then you can manually run


```bash
node dist/example.js
```

(Please note the `.js` and not `.ts` as the `build` process will translate the TypeScript files back to .Js files)

#### Release a new npm package

Releasing this repo requires a github personal access token in your environment as `NPM_TOKEN`
```bash
# using 1password (https://developer.1password.com/docs/cli/shell-plugins/github/)
NPM_TOKEN="op://private/GitHub Personal Access Token/token" op run -- npm run release
# now select what type of release you want to do and say yes to the rest of the options
```
The actual `npm publish` is done by github actions once a github release is created
