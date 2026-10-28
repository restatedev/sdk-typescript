#!/usr/bin/env bash
set -euo pipefail

# Prepare a release: bump every package to <version>, commit and tag.
# Nothing is pushed, push the commit and the tag yourself to trigger
# .github/workflows/release.yml, which verifies and publishes.
#
# Usage:
#   ./.tools/prepare-release.sh 1.18.0
#   ./.tools/prepare-release.sh 1.19.0-rc.1

SELF_PATH=${BASH_SOURCE[0]:-"$(command -v -- "$0")"}
PROJECT_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

VERSION="${1#v}"
TAG="v$VERSION"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version '$VERSION', expected e.g. 1.2.3 or 1.2.3-rc.1" >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "Not on a branch, checkout the branch to release from first" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean, commit or stash your changes first" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG already exists" >&2
  exit 1
fi

for pkg in package.json packages/libs/*/package.json; do
  jq --arg ver "$VERSION" '.version = $ver' "$pkg" >"$pkg.tmp" && mv "$pkg.tmp" "$pkg"
done

git commit -aqm "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"

if UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
  REMOTE="${UPSTREAM%%/*}"
  BRANCH="${UPSTREAM#*/}"
else
  REMOTE="origin"
fi

echo "Created commit and tag $TAG. To release, push both:"
echo
echo "  git push --atomic $REMOTE HEAD:$BRANCH $TAG"
