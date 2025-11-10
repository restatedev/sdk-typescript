# Development Guidelines

## Prerequisites
- [NodeJS](https://nodejs.org) (v20 or later)
- [pnpm](https://pnpm.io) (v10 or later)

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
│   ├── deno/
│   ├── bun/
│   ├── vercel/
│   ├── lambda/
│   ├── cloudflare/
│   └── restate-sdk-examples/
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

# In another terminal, run examples in dev mode (uses source directly)
pnpm examples:dev

# Or run a specific example
pnpm examples:dev node
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
pnpm examples:dev              # Run all examples
pnpm examples:dev node         # Run Node.js example
pnpm examples:dev restate-sdk-examples  # Run SDK examples
```

Available examples: `node`, `bun`, `deno`, `vercel`, `lambda`, `cloudflare`, `restate-sdk-examples`

### Production Mode (Uses Built Output)

Run examples with built packages:

```bash
pnpm build                     # Build packages first
pnpm examples:start node       # Run with built packages
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
pnpm examples:dev       # Run all examples (dev mode)
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
- **Changesets** for version management

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

This repo uses two release workflows:

### Option 1: Automatic Release (Recommended)

1. Create a changeset:
   ```bash
   pnpm changeset
   ```

2. Commit the changeset:
   ```bash
   git add .changeset
   git commit -m "Add changeset for new feature"
   ```

3. Merge to main branch

4. Update versions:
   ```bash
   pnpm version  # Apply changesets to bump versions
   ```

5. Push to main:
   - GitHub Actions automatically detects the version bump
   - Creates a git tag (e.g., `v1.2.3`)
   - Creates a GitHub release
   - Publishes packages to npm

### Option 2: Manual Release (For Hotfixes)

1. Create a hotfix branch:
   ```bash
   git checkout -b hotfix/critical-fix
   ```

2. Create changeset and update version:
   ```bash
   pnpm changeset
   pnpm version
   ```

3. Commit and push:
   ```bash
   git add .
   git commit -m "Release v1.2.3 - critical fix"
   git push origin hotfix/critical-fix
   ```

4. Create and push a tag:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

5. Create a GitHub release:
   ```bash
   gh release create v1.2.3 --title "Release v1.2.3" --generate-notes
   ```
   Or via GitHub UI: Releases → Draft a new release → Select the tag → Publish release

When the release is published, GitHub Actions automatically publishes packages to npm.

**Important:** Never run `pnpm release` locally. Always let GitHub Actions handle publishing to ensure consistency and proper CI checks.

## Re-generating the Discovery Manifest

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

For more detailed information about the monorepo structure and advanced features, see the [template documentation](https://github.com/restatedev/typescript-monorepo-template).
