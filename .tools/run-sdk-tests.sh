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
#   ./.tools/run-sdk-tests.sh --test-suite=default --test-name=Combinators
#
# Any unknown flags are passed through to the test runner (e.g. --test-suite, --test-name,
# --exclusions-file, --service-container-env-file).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- Version: single source of truth is the workflow file ----
SDK_TEST_SUITE_VERSION="$(grep -m1 'uses: restatedev/e2e/sdk-tests@' \
  "${REPO_ROOT}/.github/workflows/integration.yaml" | sed 's/.*@//' | tr -d ' ')"

JAR_PATH="${REPO_ROOT}/tmp/sdk-tests-${SDK_TEST_SUITE_VERSION}.jar"
JAR_URL="https://github.com/restatedev/e2e/releases/download/${SDK_TEST_SUITE_VERSION}/sdk-tests.jar"
RESTATE_IMAGE="${RESTATE_CONTAINER_IMAGE:-ghcr.io/restatedev/restate:main}"
REPORT_DIR="${REPO_ROOT}/tmp/test-report"

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
SERVICE_IMAGE="localhost/e2e-ts-test-services:local"
DOCKERFILE="packages/tests/restate-e2e-services/Dockerfile"
PASSTHROUGH=()

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --gen)
      SERVICE_IMAGE="localhost/e2e-ts-gen-test-services:local"
      DOCKERFILE="packages/libs/restate-sdk-gen/test-services/Dockerfile"
      ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

# ---- 1. Build the service image ----
if [ "$SKIP_BUILD" = false ]; then
  echo "==> Building ${SERVICE_IMAGE}..."
  "${DOCKER}" build -t "${SERVICE_IMAGE}" -f "${DOCKERFILE}" "${REPO_ROOT}"
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
