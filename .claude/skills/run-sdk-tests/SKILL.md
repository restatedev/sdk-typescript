---
name: run-sdk-tests
description: Run the Restate SDK conformance test suite locally against this SDK's Docker image. Use when the user wants to run sdk tests, run conformance tests, verify an implementation, or test against the test suite.
user-invocable: true
---

# Running SDK Conformance Tests Locally

The conformance test suite lives in a separate repo (`restatedev/e2e`). It's a Gradle/Kotlin test runner that starts Restate and the SDK service in containers and drives them through the ingress API.

## Prerequisites

- The e2e repo must be cloned alongside this one: `../e2e`
- Podman (or Docker — swap `podman` for `docker` in all commands)

## Step 1: Build the Docker image

Build from the **repo root** (the Dockerfile copies the entire monorepo for its build):

```bash
# Main e2e-services (restate-sdk-based services)
podman build -t e2e-ts:local -f packages/tests/restate-e2e-services/Dockerfile .

# Gen test-services (restate-sdk-gen-based services) — only if testing gen SDK
podman build -t e2e-ts-gen:local -f packages/libs/restate-sdk-gen/test-services/Dockerfile .
```

The build does a full `pnpm install + build` inside the container, so it takes a few minutes on first run but later builds are fast thanks to layer caching.

## Step 2: Run the tests from the e2e repo

```bash
cd ../e2e

# Run all suites (slow — use targeted runs during development)
./gradlew :sdk-tests:run --args='run --sequential --image-pull-policy=CACHED --service-container-image=localhost/e2e-ts:local'

# Run a single suite
./gradlew :sdk-tests:run --args='run --sequential --image-pull-policy=CACHED --test-suite=default --service-container-image=localhost/e2e-ts:local'

# Run a single test class
./gradlew :sdk-tests:run --args='run --sequential --image-pull-policy=CACHED --test-suite=default --test-name=Combinators --service-container-image=localhost/e2e-ts:local'
```

For the gen SDK image, replace `localhost/e2e-ts:local` with `localhost/e2e-ts-gen:local`.

## Key flags

| Flag | Purpose |
|------|---------|
| `--sequential` | Required on Podman (no parallel containers) |
| `--image-pull-policy=CACHED` | Uses locally built image; skips registry pull |
| `--test-suite=default` | Which suite to run (`default`, `alwaysSuspending`, `threeNodes`, etc.) |
| `--test-name=ClassName` | Run only one test class (requires `--test-suite`) |
| `--service-container-image=localhost/...` | The image to test against |

## Available test suites

| Suite | Description |
|-------|-------------|
| `default` | Core tests, single node |
| `alwaysSuspending` | Every invocation suspends between steps |
| `threeNodes` | Multi-node cluster |
| `persistedTimers` | Forces timer persistence |
| `lazyState` | Disabled eager state loading |

Pass `all` (the default) to run every suite sequentially.

## Reading results

Test logs are written to `../e2e/sdk-tests/test_report/<timestamp>/<suite>/<TestClass>/`:
- `testRunner.log` — client-side request/response logs and test execution
- `runtime_0.log` — Restate server log
- `default-service_0.log` — SDK service container log

A `✅` or `❌` per test is printed to stdout immediately.
