#!/usr/bin/env bash
#
# Publish a snapshot of @restatedev/tanstack-workflow to npm by hand.
#
# The repository normally publishes from CI (see .github/workflows/release.yml),
# which authenticates with npm trusted publishing over OIDC. That path requires
# pushing a branch. This script exists for the case where you want the package on
# npm without pushing, so it publishes with your own npm credentials instead.
#
#   npm login                      # once, or export NPM_TOKEN / use ~/.npmrc
#   ./scripts/publish-snapshot.sh --dry-run
#   ./scripts/publish-snapshot.sh
#
# Notes:
#   - The version is stamped as 0.0.0-SNAPSHOT-<timestamp> and reverted afterwards,
#     so nothing is committed. 0.0.0 sorts below every real release.
#   - The dist-tag is `dev`. Nothing else publishes this package, so `dev` is free
#     and collides with nothing.
#   - `--provenance` is intentionally absent: it needs the OIDC token that only CI
#     has. A local publish cannot produce a provenance attestation.
#   - `prepublishOnly` runs `pnpm -w verify` across the whole monorepo first.
#   - npm sets `latest` on a package's very first publish regardless of --tag.
#     That is harmless here and a later real release moves it normally.

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "DRY RUN: nothing will be published."
fi

VERSION="0.0.0-SNAPSHOT-$(date '+%Y%m%d%H%M%S')"
NPM_TAG="dev"

# Always put package.json back, even if the publish fails.
cp package.json package.json.orig
trap 'mv package.json.orig package.json' EXIT

jq --arg ver "$VERSION" '.version = $ver' package.json > package.json.tmp
mv package.json.tmp package.json

echo "Publishing @restatedev/tanstack-workflow@$VERSION with dist-tag $NPM_TAG"
pnpm publish --tag "$NPM_TAG" --access public --no-git-checks $DRY_RUN

echo
echo "Done. Install it with:"
echo "  pnpm add -E @restatedev/tanstack-workflow@$VERSION"
