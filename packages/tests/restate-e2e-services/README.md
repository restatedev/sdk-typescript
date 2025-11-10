## Build Docker image from the project root

```shell
docker build . -f packages/restate-e2e-services/Dockerfile -t restatedev/node-test-services
```

## Running the services locally

The Node services can be run via:

```shell
SERVICES=<COMMA_SEPARATED_LIST_OF_SERVICES> gradle npm_run_app 
```

For the list of supported services see [here](src/app.ts).
