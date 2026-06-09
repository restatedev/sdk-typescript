## Build Docker image from the project root

```shell
docker build . -f packages/tests/restate-e2e-services/Dockerfile -t restatedev/test-services-node
```

## Running the services locally

The Node services can be run directly from source (via `tsx`, no build required):

```shell
# from this package directory
pnpm app

# or from the project root
pnpm --filter @restatedev/restate-e2e-services app
```

By default all services are registered on port `9080`. The following environment
variables are supported:

| Variable                        | Default      | Purpose                                                       |
| ------------------------------- | ------------ | ------------------------------------------------------------- |
| `SERVICES`                      | all          | Comma-separated list of services to register, or `*` for all  |
| `PORT`                          | `9080`       | HTTP/2 server port                                            |
| `RESTATE_E2E_ENDPOINT_ADAPTER`  | `node-http2` | Endpoint implementation (`node-http2` or `fetch`)             |

Examples:

```shell
SERVICES=Counter,EventHandler PORT=9080 pnpm app

# run with the fetch-based endpoint adapter
pnpm app:fetch
```

For the list of supported services see [here](src/app.ts).
