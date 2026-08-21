#!/usr/bin/env bash
#
# Publishes the napi shared-core packages: the per-platform binary packages
# (@restatedev/restate-sdk-shared-core-native-<triple>) and the main loader
# package (@restatedev/restate-sdk-shared-core-native).
#
# Expects the prebuilt binaries (one .node per target) to have already been
# downloaded into packages/libs/restate-sdk-shared-core-native/artifacts/ (see
# the build-native job / native.yaml). Run AFTER the package version has been
# finalized for this release (snapshot or tagged), so the per-platform packages
# inherit the right version.
#
# Usage: .tools/publish-native.sh <npm-dist-tag>   e.g. dev | latest | rc
set -euo pipefail

TAG="${1:?npm dist-tag required (e.g. dev, latest, rc)}"
PKG_DIR="packages/libs/restate-sdk-shared-core-native"

# Every published target — keep in sync with native.yaml and the napi `triples`.
TRIPLES=(linux-x64-gnu linux-arm64-gnu linux-x64-musl linux-arm64-musl darwin-arm64)

pushd "$PKG_DIR" >/dev/null

# Create npm/<triple>/ package dirs (with os/cpu/libc + current version) and
# distribute the downloaded .node binaries into them.
pnpm exec napi create-npm-dirs
pnpm exec napi artifacts

# Completeness gate (mirrors the Java SDK): never publish a release whose
# optionalDependencies would point at a missing platform package.
missing=0
for triple in "${TRIPLES[@]}"; do
  if ! ls "npm/${triple}"/*.node >/dev/null 2>&1; then
    echo "ERROR: missing native binary for ${triple}"
    missing=1
  fi
done
if [ "$missing" != 0 ]; then
  echo "Aborting native publish: incomplete platform binaries."
  exit 1
fi

# Publish the per-platform packages and inject their versions into this
# package's optionalDependencies.
pnpm exec napi prepublish -t npm --skip-gh-release

# Publish the main loader package.
npm publish --tag "$TAG" --access public --provenance

popd >/dev/null
