### TypeScript SDK PoC 

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


#### Editor support

If you are using `vscode`, install the following extentions:
* Typescript plugin by Microsoft.
* ESLint


#### Run the example file

Since this project final artifact is a node package that others would import in their projects,
interactive development might be a bit tedious, so as a temporary productivity boost I've added `example.ts` 
that is going to be built as part of this artifact for now.
After building the project `npm run build` you can run:

Make sure to *build first* then run:

```bash
node dist/example.js
```

It should just print Hello world.
