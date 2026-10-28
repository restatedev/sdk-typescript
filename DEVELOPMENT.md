# Development Guidelines

## Prerequisites
- [NodeJS](https://nodejs.org) (v22 or later)
- [pnpm](https://pnpm.io) (v11 or later)

## Project Structure

This is a monorepo containing multiple SDK packages:

```
packages/
├── libs/                           # SDK libraries (published to npm)
│   ├── restate-sdk/               # Main SDK
│   ├── restate-sdk-clients/       # Client library
│   ├── restate-sdk-core/          # Core functionality
│   ├── restate-sdk-cloudflare-workers/  # Cloudflare Workers support
│   ├── restate-sdk-testcontainers/     # Testing utilities
│   └── restate-sdk-zod/           # Zod integration
├── examples/                       # Example applications
│   ├── node/
│   ├── bun/
│   ├── vercel/
│   ├── lambda/
│   ├── cloudflare/
└── tests/
    └── restate-e2e-services/      # E2E test services
```

## Getting Started

### Install Dependencies

```bash
pnpm install
```

### Building the SDK

Build all library packages:

```bash
pnpm build
```

Build a specific package:

```bash
pnpm --filter @restatedev/restate-sdk build
```

If everything goes well, artifacts are created in each package's `dist/` directory.

## Development Workflow

### Watch Mode (Recommended)

For development, you can use watch mode which provides instant type checking without builds:

```bash
# Watch all lib packages (type checking only)
pnpm dev

# In another terminal, run the node example in dev mode (uses source directly)
pnpm examples:dev

# Or run a specific example
pnpm examples:dev bun
```

### Testing Changes

Run all tests:

```bash
pnpm test
```

Run tests in watch mode (instant feedback, no build required):

```bash
pnpm test:watch
```

Run tests for a specific package:

```bash
pnpm --filter restate-e2e-services test
```

### Code Quality

Run the formatter and linter:

```bash
pnpm format        # Format all files
pnpm lint          # Lint all packages
```

Before committing, run all checks (same as CI):

```bash
pnpm verify
```

This runs:
- Format check
- Lint
- Type check
- Build all packages
- Tests
- Export validation (ATTW)
- API validation (API Extractor)

## Running Examples

### Development Mode (Uses Source)

Run examples without building:

```bash
pnpm examples:dev              # Run Node.js example (default)
pnpm examples:dev bun          # Run Bun example
pnpm examples:dev cloudflare   # Run Cloudflare example
```

Available examples: `node` (default), `bun`, `vercel`, `lambda`, `cloudflare`

### Production Mode (Uses Built Output)

Run examples with built packages:

```bash
pnpm build                     # Build packages first
pnpm examples:start            # Run node example with built packages
pnpm examples:start bun        # Run bun example with built packages
```

## Package Management

### Adding Dependencies

Add a dependency to a specific package:

```bash
pnpm --filter @restatedev/restate-sdk add <package-name>
```

Add a dev dependency to the root:

```bash
pnpm add -Dw <package-name>
```

### Managing Monorepo Dependencies

Packages depend on each other using workspace protocol:

```json
{
  "dependencies": {
    "@restatedev/restate-sdk-core": "workspace:*"
  }
}
```

For publishable packages that depend on other publishable packages, add them to `external` in `tsdown.config.ts`:

```typescript
export default defineConfig({
  entry: ["src/index.ts"],
  external: ["@restatedev/restate-sdk-core"],
});
```

## Common Commands

```bash
# Building
pnpm build              # Build lib packages only
pnpm build:all          # Build everything (libs + examples)
pnpm clean              # Clean build artifacts
pnpm clean:cache        # Clear turbo cache

# Development
pnpm dev                # Watch libs (type checking)
pnpm examples:dev       # Run node example (dev mode)
pnpm test:watch         # Test in watch mode

# Quality checks
pnpm verify             # Run all checks (CI equivalent)
pnpm lint               # Lint all packages
pnpm format             # Format all files
pnpm check:format       # Check formatting
pnpm check:types        # Type check
pnpm check:exports      # Verify package exports (ATTW)
pnpm check:api          # Check for forgotten type exports

# Package management
pnpm new                # Create a new package (interactive)
pnpm delete             # Delete a package (interactive)
pnpm add-entry          # Add custom entry point (interactive)

# Dependencies
pnpm deps:check         # Check for outdated dependencies
pnpm deps:update        # Update all dependencies
```

## How It Works

This monorepo uses:
- **pnpm workspaces** for package management
- **Turbo** for task orchestration and caching
- **tsdown** for building publishable packages (ESM + CJS + TypeScript declarations)
- **Vitest** for testing

### Dev vs Production Modes

**Dev Mode (Fast):**
- Libs: Type checking only (`tsc --noEmit --watch`)
- Examples: Use source files directly via path mappings
- Tests: Vitest resolves libs from source
- No build required! Changes reflect immediately

**Production Mode (Validation):**
- Libs: Built to `dist/` with tsdown
- Examples: Use built output from `dist/`
- Tests: Run against built packages
- Validates actual published code

## Releasing the Package

All packages are always released together, with the same version. There are no changesets or changelogs: release notes are generated in the GitHub release, edit them there if needed.

1. Prepare the release commit and tag (nothing is pushed):
   ```bash
   .tools/prepare-release.sh 1.2.3
   ```

2. Push the commit and the tag, the script prints the exact command:
   ```bash
   git push --atomic origin HEAD:main v1.2.3
   ```

3. The tag push triggers the `Release` workflow (`.github/workflows/release.yml`), which:
   - Runs all the verification workflows (build and test, integration, compatibility) on the tagged commit
   - Builds and publishes all the packages to npm
   - Creates the GitHub release with auto-generated notes
   - Deploys the docs

**Pre-releases:** versions like `1.2.3-rc.1` are published with the pre-release identifier as npm dist-tag (e.g. `rc`), and marked as pre-release on GitHub.

**Backports:** run the script on a `release-*` branch and push to that branch. If the version is lower than the current `latest` on npm, it's published with the `release-<major>.<minor>` dist-tag instead.

**Retrying:** if a job fails (e.g. a flaky test), re-run the failed jobs of the `Release` run, or run the workflow manually on the tag. Packages already on npm are skipped.

**Snapshots:**

- Every push to main publishes a `0.0.0-SNAPSHOT-<timestamp>` version with the `dev` dist-tag, use it with `"@restatedev/restate-sdk": "^0.0.0-SNAPSHOT"`.
- To publish a snapshot of any branch, run the `Release` workflow manually on that branch (Actions → Release → Run workflow), optionally setting `snapshot_name` (defaults to the branch name). This skips the tests and publishes `0.0.0-SNAPSHOT.<name>.<timestamp>` with `<name>` as dist-tag, use it with `"@restatedev/restate-sdk": "<name>"`. These never resolve from `^0.0.0-SNAPSHOT`.

## Re-generating the Discovery Manifest

The discovery manifest types in `packages/libs/restate-sdk/src/endpoint/discovery.ts` are auto-generated from the JSON Schema defined in the Restate server repository. These types define the structure that SDK endpoints return during service discovery.

To regenerate after a protocol update:

1. Download the latest schema from the [Restate server repo](https://github.com/restatedev/restate/blob/main/service-protocol/endpoint_manifest_schema.json)
2. Run:
   ```bash
   npx --package=json-schema-to-typescript json2ts endpoint_manifest_schema.json packages/libs/restate-sdk/src/endpoint/discovery.ts
   ```

## After Releasing

After creating a new SDK release, update dependent projects:

1. [Update and release the tour of Restate](https://github.com/restatedev/tour-of-restate-typescript#upgrading-typescript-sdk)
2. [Update the TypeScript SDK and Tour version in the documentation](https://github.com/restatedev/documentation#upgrading-typescript-sdk-version)
3. [Update and release the Node template generator](https://github.com/restatedev/node-template-generator#upgrading-typescript-sdk)
4. [Update the examples](https://github.com/restatedev/examples#upgrading-the-sdk-dependency-for-restate-developers)

## Advanced Topics

### Turbo Caching

Turbo automatically caches task outputs. Package scripts use `turbo run --filter={.}...` which:
- Runs the command for the current package
- Automatically builds dependencies first
- Leverages Turbo's caching for speed

You can run commands from any package directory, and Turbo will handle dependencies:

```bash
cd packages/libs/restate-sdk
pnpm build          # Builds this package AND its dependencies
pnpm test           # Tests this package (builds dependencies first)
```

### TypeScript Configuration

- `tsconfig.base.json` - Shared compiler options
- `tsconfig.json` - Extends base + path mappings (auto-generated for IDE support)
- `tsconfig.build.json` - Clean builds (used by tsdown)

Path mappings are auto-generated when packages are created/deleted.

### Private vs Public Packages

- **Public packages** (in `packages/libs/`) are built with tsdown and published to npm
- **Private packages** are source-only and get bundled into public packages automatically
- Only non-private packages in `packages/libs/` are published

### Building the Shared Core (WASM)

The SDK includes Rust/WASM bindings in `sdk-shared-core-wasm-bindings/`. Most contributors don't need to rebuild this, but if you're modifying the shared core:

```bash
pnpm build:core
```

**Prerequisites:**
- [Rust](https://www.rust-lang.org/tools/install) (version specified in `rust-toolchain.toml`)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) - install via `cargo install wasm-pack`

**macOS Note:** If you encounter C compiler errors (from the `ring` crate), install LLVM via Homebrew and set the compiler paths:

```bash
brew install llvm
CC=/opt/homebrew/opt/llvm/bin/clang AR=/opt/homebrew/opt/llvm/bin/llvm-ar pnpm build:core
```

For more detailed information about the monorepo structure and advanced features, see the [template documentation](https://github.com/restatedev/typescript-monorepo-template).
