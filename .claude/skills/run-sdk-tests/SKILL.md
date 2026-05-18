---
name: run-sdk-tests
description: Run the Restate SDK conformance test suite locally against this SDK's Docker image. Use when the user wants to run sdk tests, run conformance tests, verify an implementation, or test against the test suite.
user-invocable: true
---

# Running SDK Conformance Tests Locally

The conformance test suite lives in a separate repo (`restatedev/e2e`). It's a Gradle/Kotlin test runner that starts Restate and the SDK service in containers and drives them through the ingress API.

## Quick start — use the script

```bash
# Build image + run all default suite tests
./.tools/run-sdk-tests.sh

# Skip rebuild if you haven't changed service code
./.tools/run-sdk-tests.sh --skip-build

# Test the restate-sdk-gen services
./.tools/run-sdk-tests.sh --gen

# Run a single test class (extra flags pass through to the runner)
./.tools/run-sdk-tests.sh --skip-build --test-suite=default --test-name=Combinators
```

## Prerequisites

- Java 21+
- Podman or Docker

## What the script does

1. Reads the suite version from `.github/workflows/integration.yaml` (single source of truth — no version to keep in sync manually)
2. Builds the service Docker image from the repo root
3. Downloads the `sdk-tests.jar` from GitHub releases and caches it in `tmp/` (version-pinned filename)
4. Pulls the Restate runtime image explicitly
5. Runs `java -jar sdk-tests.jar run ...` directly — no Docker wrapper, Java runs on the host

## Manual invocation (without the script)

If you need more control, download the JAR and run it directly:

```bash
# Check current version
grep -m1 'uses: restatedev/e2e/sdk-tests@' .github/workflows/integration.yaml

# Run
RESTATE_CONTAINER_IMAGE=ghcr.io/restatedev/restate:main \
  java -jar tmp/sdk-tests-<version>.jar run \
  --sequential \
  --image-pull-policy=CACHED \
  --test-suite=default \
  --test-name=Combinators \
  --service-container-image=localhost/e2e-ts-test-services:local
```

## Key flags (passed through to the runner)

| Flag | Purpose |
|------|---------|
| `--test-suite=default` | Which suite to run (`default`, `alwaysSuspending`, `threeNodes`, etc.) |
| `--test-name=ClassName` | Run only one test class (requires `--test-suite`) |
| `--exclusions-file=path` | YAML file listing tests to skip |

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
