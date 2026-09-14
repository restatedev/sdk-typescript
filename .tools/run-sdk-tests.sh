#!/usr/bin/env bash
set -euo pipefail

# Run the Restate SDK conformance test suite locally.
#
# Prerequisites:
#   - Java 21+
#   - podman or docker
#
# Usage:
#   ./.tools/run-sdk-tests.sh                          # build image + run all default suite tests
#   ./.tools/run-sdk-tests.sh --skip-build             # skip image build, reuse existing
#   ./.tools/run-sdk-tests.sh --gen                    # test the restate-sdk-gen services
#   ./.tools/run-sdk-tests.sh --ts-core                # force the pure TypeScript shared core
#   ./.tools/run-sdk-tests.sh --test-suite=default --test-name=Combinators
#
# Any unknown flags are passed through to the test runner (e.g. --test-suite, --test-name,
# --exclusions-file, --service-container-env-file).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- Version: single source of truth is the workflow file ----
SDK_TEST_SUITE_VERSION="$(grep -m1 'uses: restatedev/e2e/sdk-tests@' \
  "${REPO_ROOT}/.github/workflows/integration.yaml" | sed 's/.*@//' | tr -d ' ')"

JAR_PATH="${REPO_ROOT}/sdk-tests.jar"
JAR_URL="https://github.com/restatedev/e2e/releases/download/${SDK_TEST_SUITE_VERSION}/sdk-tests.jar"
RESTATE_IMAGE="${RESTATE_CONTAINER_IMAGE:-ghcr.io/restatedev/restate:main}"
DATE="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="${REPO_ROOT}/test-report/${DATE}"

# ---- Detect container runtime ----
if command -v podman &>/dev/null; then
  DOCKER=podman
elif command -v docker &>/dev/null; then
  DOCKER=docker
else
  echo "Error: neither podman nor docker found" >&2
  exit 1
fi

# ---- Parse args ----
SKIP_BUILD=false
TS_CORE=false
SERVICE_IMAGE="localhost/e2e-ts-test-services:local"
DOCKERFILE="packages/tests/restate-e2e-services/Dockerfile"
PASSTHROUGH=()

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --ts-core) TS_CORE=true ;;
    --gen)
      SERVICE_IMAGE="localhost/e2e-ts-gen-test-services:local"
      DOCKERFILE="packages/libs/restate-sdk-gen/test-services/Dockerfile"
      ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

# Run the services on the pure TypeScript shared core instead of the WASM one.
# The Dockerfile is derived at build time rather than committed, so it cannot
# drift from the real one.
if [ "$TS_CORE" = true ]; then
  SERVICE_IMAGE="${SERVICE_IMAGE%:*}:tscore"
  GENERATED_DOCKERFILE="$(mktemp "${TMPDIR:-/tmp}/restate-tscore-dockerfile.XXXXXX")"
  trap 'rm -f "${GENERATED_DOCKERFILE}"' EXIT
  {
    cat "${REPO_ROOT}/${DOCKERFILE}"
    echo ""
    echo "ENV RESTATE_SHARED_CORE=ts"
  } > "${GENERATED_DOCKERFILE}"
  DOCKERFILE="${GENERATED_DOCKERFILE#"${REPO_ROOT}/"}"
  echo "==> Forcing the TypeScript shared core (RESTATE_SHARED_CORE=ts)"
fi

# ---- 1. Build the service image ----
if [ "$SKIP_BUILD" = false ]; then
  echo "==> Building ${SERVICE_IMAGE}..."
  if [ "$TS_CORE" = true ]; then
    "${DOCKER}" build -t "${SERVICE_IMAGE}" -f "${GENERATED_DOCKERFILE}" "${REPO_ROOT}"
  else
    "${DOCKER}" build -t "${SERVICE_IMAGE}" -f "${DOCKERFILE}" "${REPO_ROOT}"
  fi
fi

# ---- 2. Download the test suite JAR (cached by version) ----
mkdir -p "$(dirname "$JAR_PATH")"
if [ ! -f "$JAR_PATH" ]; then
  echo "==> Downloading sdk-test-suite ${SDK_TEST_SUITE_VERSION}..."
  curl -fSL -o "$JAR_PATH" "$JAR_URL"
else
  echo "==> Using cached sdk-test-suite ${SDK_TEST_SUITE_VERSION}"
fi

# ---- 3. Pull the Restate runtime image ----
echo "==> Pulling Restate image: ${RESTATE_IMAGE}..."
"${DOCKER}" pull "${RESTATE_IMAGE}"

# ---- 4. Run the tests ----
echo "==> Running integration tests (suite ${SDK_TEST_SUITE_VERSION})..."
rm -rf "${REPORT_DIR}"
mkdir -p "${REPORT_DIR}"

RESTATE_CONTAINER_IMAGE="${RESTATE_IMAGE}" java -jar "${JAR_PATH}" run \
  --sequential \
  --image-pull-policy=CACHED \
  --report-dir="${REPORT_DIR}" \
  --service-container-image="${SERVICE_IMAGE}" \
  "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"

echo ""
echo "==> Done. Report: ${REPORT_DIR}"
