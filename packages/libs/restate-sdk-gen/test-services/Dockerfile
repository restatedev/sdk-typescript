# Test-services container for @restatedev/restate-sdk-gen, consumed by
# sdk-test-suite (the same harness that exercises restate-e2e-services).
# Build context MUST be the sdk-typescript workspace root.

FROM node:20

WORKDIR /usr/src/app

# Tini forwards signals so SIGTERM from sdk-test-suite shuts the
# endpoint down cleanly between scenarios.
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

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
CMD ["pnpm", "--filter", "@restatedev/restate-sdk-gen", "exec", "tsx", "test-services/src/server.ts"]
