# Development Guide

Complete guide for developing with this TypeScript monorepo.

## Table of Contents

- [Getting Started](#getting-started)
- [Package Types](#package-types)
- [Managing Dependencies](#managing-dependencies)
- [Development Commands](#development-commands)
- [How It Works](#how-it-works)
- [Releasing](#releasing)
- [GitHub Actions Setup](#github-actions-setup)
- [Project Structure](#project-structure)

## Getting Started

When you clone this repository, you'll find an empty monorepo ready for your packages.

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Create Your First Package

```bash
pnpm new
```

This will prompt you for:
- **Package type**: `lib` (library), `test` (test package), or `example` (example app)
- **Package name**: e.g., `my-package`
- **Private**: Whether the package should be private (for libs only)

The generator will:
- Create the package structure
- Generate TypeScript configs
- Update workspace path mappings
- Install dependencies automatically

### 3. Add Custom Entry Points (Optional)

To add additional entry points to a public lib (e.g., `@restatedev/my-lib/utils`):

```bash
pnpm add-entry
```

This **automatically**:
- ✅ Creates the source file with placeholder code
- ✅ Updates `package.json` exports and `typesVersions` (for Node 10 compatibility)
- ✅ Updates `tsdown.config.ts` entry array
- ✅ Updates root `tsconfig.json` paths for IDE support
- ✅ Creates `api-extractor.{entry}.json` config
- ✅ Updates `_check:api` script to validate the new entry
- ✅ Formats all modified files

### 4. Start Developing

```bash
# Watch lib packages (type checking only, no build)
pnpm dev

# Run examples in dev mode (uses source, no build required)
pnpm examples:dev

# Run tests in watch mode (tests source directly)
pnpm test:watch
```

## Package Types

### Lib Packages

**Public libs** are built with tsdown and published to npm:

```json
{
  "name": "@restatedev/package-name",
  "scripts": {
    "build": "tsdown",
    "dev": "tsc --noEmit --watch"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "publishConfig": {
    "access": "public"
  }
}
```

**Private libs** are source-only (no build step):

```json
{
  "private": true,
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Private packages get bundled into public packages automatically! This is useful for internal utilities that don't need to be published separately.

**Adding custom entry points** to public libs:

Use `pnpm add-entry` to add subpath exports like `@restatedev/my-lib/utils`:

```bash
pnpm add-entry
# Select package → Enter entry name (e.g., "utils" or "internal/helpers")
```

This **automatically**:
- ✅ Creates the source file with placeholder code
- ✅ Updates `package.json` exports and `typesVersions` (for Node 10 compatibility)
- ✅ Updates `tsdown.config.ts` entry array
- ✅ Updates root `tsconfig.json` paths for IDE support
- ✅ Creates `api-extractor.{entry}.json` config
- ✅ Updates `_check:api` script to validate the new entry
- ✅ Formats all modified files

You can then import it separately:

```typescript
import { foo } from '@restatedev/my-lib';        // Main entry
import { bar } from '@restatedev/my-lib/utils';  // Custom entry
```

All validation tools pass automatically:
- ✅ `check:exports` - ATTW validates all subpath exports (including Node 10)
- ✅ `check:api` - API Extractor validates the custom entry
- ✅ `check:types` - TypeScript checks all source files

### Test Packages

Test packages use Vitest and test your libraries:

```bash
pnpm test         # Tests built output (production-like)
pnpm test:watch   # Tests source directly (fast feedback)
```

### Example Packages

Example packages demonstrate your libraries in action:

```bash
pnpm examples:dev       # Run all examples (uses source)
pnpm examples:dev demo  # Run specific example
pnpm examples:start     # Run with built libs (production-like)
```

## Managing Dependencies

### Adding Workspace Dependencies

To add a dependency between packages (e.g., example depends on your lib):

```bash
cd packages/examples/my-example
pnpm add "@restatedev/my-lib@workspace:*"
```

The `pnpm new` and `pnpm delete` commands automatically run `pnpm install` after modifying packages to ensure everything is linked properly.

### Adding External Dependencies

For regular npm packages:

```bash
# Add to specific package
pnpm --filter @restatedev/package-name add zod

# Add to root (dev dependencies)
pnpm add -Dw prettier
```

### Using PNPM Catalogs

Catalogs help manage shared dependencies (especially peer dependencies) across all packages. This ensures version consistency.

**1. Add to catalog in `pnpm-workspace.yaml`:**

```yaml
catalog:
  zod: ^4.1.12
  react: ^18.3.1
```

**2. Use in packages with `catalog:`:**

```json
{
  "peerDependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "zod": "catalog:"
  }
}
```

**3. Install:**

```bash
pnpm install
```

This is perfect for managing peer dependencies consistently across all your packages!

## Development Commands

### From Root Directory

```bash
# Package management
pnpm new                # Create a new package
pnpm delete             # Delete a package
pnpm add-entry          # Add custom entry point to a public lib

# Development
pnpm dev                # Watch libs (type checking)
pnpm examples:dev       # Run all examples (dev mode)
pnpm examples:dev demo  # Run specific example

# Building
pnpm build              # Build lib packages only
pnpm build:all          # Build all packages (libs + examples)

# Testing
pnpm test               # Test all packages (built output)
pnpm test:watch         # Test in watch mode (source)

# Quality checks
pnpm lint               # Lint all packages
pnpm format             # Format all files
pnpm check:format       # Check formatting
pnpm check:types        # Type check all packages
pnpm check:exports      # Verify package exports (ATTW)
pnpm check:api          # Check for forgotten type exports
pnpm verify             # Run all checks (same as CI)

# Utilities
pnpm clean              # Clean build artifacts
pnpm clean:cache        # Clear turbo caches
pnpm deps:check         # Check for outdated dependencies
pnpm deps:update        # Update all dependencies
```

### From Package Directory

All commands work from within a package directory too! Just `cd` into any package and run:

```bash
cd packages/libs/public-api

pnpm build          # Builds this package AND its dependencies
pnpm test           # Tests this package (builds dependencies first)
pnpm check:types    # Type checks this package (builds dependencies first)
pnpm dev            # Dev mode (type checking only)
pnpm lint           # Lint this package
```

This works because package scripts use `turbo run --filter={.}...` which:
- Runs the command for this package
- Automatically builds upstream dependencies first
- Leverages Turbo's caching

**Tip:** Always run `pnpm verify` before committing - it runs all the checks that CI will run!

## How It Works

### Dev Mode (No Build Required!)

In dev mode, your examples and tests can use lib packages without building them:

- **Libs**: `tsc --noEmit --watch` for type checking only
- **Examples**: Use TypeScript path mappings to source files
- **Tests**: Vitest automatically resolves libs from source in watch mode

This means instant feedback - change lib code and see results immediately!

**Dev workflow:**
```bash
pnpm dev              # Type check libs
pnpm examples:dev     # Run examples with source
pnpm test:watch       # Test source directly
```

### Production Mode

When you run `pnpm build` (or `build:all`), `pnpm test`, or `pnpm examples:start`:

- Libs are built to `dist/` with tsdown (ESM + CJS + TypeScript declarations)
- Examples and tests use the built output
- This validates your actual published code

**Build commands:**
- `pnpm build` - Builds lib packages only (faster, default)
- `pnpm build:all` - Builds everything including examples (used in CI)

### TypeScript Configuration

The repo uses a layered TypeScript configuration:

**Root Level:**
- `tsconfig.base.json` - Shared compiler options
- `tsconfig.json` - Extends base + adds path mappings for IDE

**Package Level:**
- `tsconfig.json` - Extends root (inherits path mappings)
- `tsconfig.build.json` - Extends base (clean builds)

Path mappings are auto-generated when you create/delete packages via `pnpm generate:configs`.

### Turbo

Turbo runs automatically when you use `pnpm` commands:

- **Smart caching** - Skip unchanged work
- **Parallel execution** - Run tasks simultaneously
- **Dependency awareness** - Build deps first automatically

You don't need to think about Turbo - just use `pnpm build`, `pnpm test`, etc!

**How it works:**
- Package scripts use `turbo run _build --filter={.}...`
- The `--filter={.}...` means "this package and its dependencies"
- Internal `_build`, `_test`, etc. tasks have `dependsOn: ["^_build"]` in `turbo.json`
- Turbo automatically builds dependencies before running the task

This means you can run `pnpm build` from any package directory and it will automatically build dependencies first!

## Releasing

This monorepo supports two release workflows:

**Note:** Only public (publishable) packages will appear in the changeset prompt. Private packages are automatically excluded from version bumps and publishing.

### Option 1: Automatic Release with Changesets (Recommended)

This workflow uses [Changesets](https://github.com/changesets/changesets) for automated version management.

#### 1. Create a changeset

```bash
pnpm changeset
```

Select packages to version and describe changes.

#### 2. Commit the changeset

```bash
git add .changeset
git commit -m "Add changeset for new feature"
```

#### 3. Merge to main

When merged to main:
- GitHub Actions detects the new version in package.json
- Automatically creates a git tag (e.g., `v1.2.3`)
- Creates a GitHub release
- Publishes packages to npm

### Option 2: Manual Release with Tags (For Hotfixes)

Use this workflow for hotfix branches that need to be released without merging to main first.

#### 1. Create a hotfix branch and update version

```bash
git checkout -b hotfix/critical-fix
```

#### 2. Create a changeset and update version

```bash
pnpm changeset        # Create changeset for the fix
pnpm version          # Apply changesets to update package.json and CHANGELOG
```

#### 3. Commit and push the version change

```bash
git add .
git commit -m "Release v1.2.3 - critical fix"
git push origin hotfix/critical-fix
```

#### 4. Create and push a tag

```bash
git tag v1.2.3
git push origin v1.2.3
```

#### 5. Create a GitHub release

Manually create a GitHub release for the tag:

```bash
gh release create v1.2.3 --title "Release v1.2.3" --generate-notes
```

Or via GitHub UI: Go to Releases → Draft a new release → Select the tag → Publish release

When the release is published, GitHub Actions automatically publishes packages to npm.

**Important:** Never run `pnpm release` locally. Always let GitHub Actions handle publishing to npm to ensure consistency and proper CI checks.

## GitHub Actions Setup

The repo includes three workflows:

### PR Checks (`ci.yml`)
Runs on every PR:
- Format check
- Lint
- Type check
- Build all packages (`pnpm build:all`)
- Test
- Verify exports (ATTW)
- Verify API (API Extractor)

### Automatic Release (`release.yml`)
Runs automatically on push to main:
- Checks for new package versions in `packages/libs/*/package.json`
- If new version detected (version doesn't have a git tag):
  - Creates and pushes git tag (e.g., `v1.2.3`)
  - Creates GitHub release with auto-generated notes
  - Calls the publish workflow to publish to npm

This workflow enables the **automatic changesets workflow**: when you merge a PR that bumps the version in package.json (via changesets), this workflow automatically creates the tag and release.

### Manual Release (`manual-publish.yml`)
Runs when:
- A GitHub release is manually published
- Manually triggered via workflow_dispatch

This workflow enables the **manual hotfix workflow**: you can create a hotfix branch, update package.json version (ideally using changesets), commit the change, create a git tag, then manually publish a GitHub release for that tag to trigger publishing.

### Shared Publish Workflow (`publish.yml`)
Both release workflows use this shared workflow that:
- Installs dependencies
- Builds lib packages (`pnpm build`)
- Publishes public packages to npm

### NPM Publishing Setup

1. Get an NPM token from https://www.npmjs.com/settings/YOUR_USERNAME/tokens (create automation token)
2. Add it to GitHub Secrets: Settings → Secrets → Actions → `NPM_TOKEN`
3. Ensure publishable packages have:
   ```json
   {
     "publishConfig": {
       "access": "public"
     }
   }
   ```

## Project Structure

```
.
├── packages/
│   ├── libs/          # Library packages (empty to start)
│   ├── tests/         # Test packages (empty to start)
│   └── examples/      # Example apps (empty to start)
├── .github/
│   └── workflows/     # CI/CD workflows
├── .templates/        # Plop templates
├── scripts/           # Utility scripts
├── .changeset/        # Changesets configuration
├── turbo.json         # Turbo task configuration
├── plopfile.js        # Package generator
└── pnpm-workspace.yaml # Workspace config with catalogs
```

## Key Concepts

### Module Resolution Testing

ATTW (Are The Types Wrong) automatically tests your packages against different module resolution modes (node16, bundler, etc.). This catches issues like:
- Missing type exports
- Incorrect module formats
- Path resolution problems

### Forgotten Exports

API Extractor will error if you use types in public APIs that aren't exported. This ensures your package consumers can use all necessary types.

### Private Packages

Mark packages as private in `package.json` to prevent accidental publishing. Private lib packages don't need a build script - they're bundled into public packages automatically through tsdown.
