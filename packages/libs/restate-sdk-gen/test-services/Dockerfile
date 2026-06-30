# Test-services container for @restatedev/restate-sdk-gen, consumed by
# sdk-test-suite (the same harness that exercises restate-e2e-services).
# Build context MUST be the sdk-typescript workspace root.

FROM node:22

WORKDIR /usr/src/app

# Tini forwards signals so SIGTERM from sdk-test-suite shuts the
# endpoint down cleanly between scenarios.
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Whole workspace — needed because @restatedev/restate-sdk-gen has
# workspace deps (@restatedev/restate-sdk, restate-sdk-clients, …) that
# pnpm resolves via symlinks into sibling packages.
COPY . .

RUN pnpm install --frozen-lockfile

# Build the lib so test-services can resolve `@restatedev/restate-sdk-gen`
# to its `dist/` output via the workspace symlink. (Without this, tsx
# would also work via the root tsconfig's `paths`, but compiling once
# at image build time is faster and surfaces type errors before runtime.)
RUN pnpm --filter @restatedev/restate-sdk-gen build

EXPOSE 9080
ENTRYPOINT ["tini", "--"]
# Launch with plain `node` (loading the tsx ESM hook), NOT `pnpm exec`.
# Going through pnpm makes the corepack shim reach out to registry.npmjs.org
# to (re)fetch the pinned pnpm at container start; an unhandled fetch error
# there crashes the whole node process before the endpoint binds, which
# surfaces to sdk-test-suite as a discovery DNS/timeout failure. node + tsx
# is fully offline at runtime (tsx is already installed in node_modules, and
# the restate-sdk-gen dist built above is resolved via the workspace symlink).
CMD ["node", "--import", "tsx", "/usr/src/app/packages/libs/restate-sdk-gen/test-services/src/server.ts"]
