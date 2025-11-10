# AI Agent Guide

This document provides guidance for AI coding assistants (like Claude, Cursor, etc.) working with this TypeScript monorepo.

## ⚠️ Critical: Interactive Commands

**DO NOT RUN these commands directly - they will hang:**

- `pnpm new` - Package generator
- `pnpm delete` - Package deletion
- `pnpm add-entry` - Add custom entry points
- `pnpm changeset` - Create changesets

**Instead:** Ask the user to run these commands and wait for them to complete. Provide clear instructions on what options to select.

**Safe to run (non-interactive):**
- `pnpm install`, `pnpm build`, `pnpm test`, `pnpm verify`
- `pnpm dev`, `pnpm lint`, `pnpm format`
- `pnpm version` (applies changesets)
- `pnpm generate:configs` (regenerates TypeScript configs)

## Project Overview

This is a TypeScript monorepo template built with:
- **PNPM Workspaces** for package management
- **Turbo** for task orchestration and caching
- **tsdown** for building publishable packages
- **Vitest** for testing
- **Changesets** for version management

## Key Concepts

### Package Types

1. **Public Libraries** (`packages/libs/*/` with `private: false`)
   - Built with tsdown to `dist/`
   - Published to npm
   - Support ESM + CJS + TypeScript declarations
   - Can have multiple entry points (subpath exports)

2. **Private Libraries** (`packages/libs/*/` with `private: true`)
   - Source-only (no build step)
   - Used internally, bundled into public packages
   - Main points to `./src/index.ts`

3. **Test Packages** (`packages/tests/*/`)
   - Always private
   - Use Vitest for testing
   - Can test libraries from source (dev) or built output (CI)

4. **Example Packages** (`packages/examples/*/`)
   - Always private
   - Demonstrate library usage
   - Can run from source (dev) or built output (production)

### Build System

- **Dev Mode**: No builds required! Type checking only with `tsc --noEmit --watch`
- **Production Mode**: Full builds with tsdown (ESM + CJS + declarations)
- **Turbo**: Automatically handles dependency ordering and caching
- **Path Mappings**: Auto-generated in root `tsconfig.json` for IDE support

### Important Files

- `.templates/` - Plop templates for generating packages
- `turbo.json` - Task configuration with dependency graph
- `pnpm-workspace.yaml` - Workspace configuration with catalogs
- `tsconfig.base.json` - Shared TypeScript config
- `vitest.config.ts` - Shared test configuration
- `api-extractor.base.json` - API validation configuration

## Common Tasks

### Creating a New Package

**⚠️ IMPORTANT: This is an interactive command - DO NOT RUN IT DIRECTLY**

The `pnpm new` command is interactive and will hang if run by an AI agent. Instead:

1. **Ask the user to run it:**
   ```
   "Please run `pnpm new` to create a new package. I'll help you configure it after."
   ```

2. **Or inform the user what needs to be created and let them decide:**
   ```
   "To add a new library package, you'll need to run `pnpm new` and select:
   - Package type: lib
   - Package name: my-package
   - Private: no (for publishable) or yes (for internal)
   
   Would you like me to wait while you run this, or would you prefer to do it later?"
   ```

**Never attempt to run interactive commands like:**
- `pnpm new` - Package generator (interactive prompts)
- `pnpm delete` - Package deletion (interactive selection)
- `pnpm add-entry` - Entry point addition (interactive prompts)
- `pnpm changeset` - Changeset creation (interactive prompts)

### Adding Package Dependencies

**For monorepo dependencies:**
```bash
cd packages/libs/my-package
pnpm add "@restatedev/other-package@workspace:*"
```

**For publishable packages depending on other publishable packages:**
Add to `tsdown.config.ts`:
```typescript
export default defineConfig({
  // ...
  external: ["@restatedev/other-package"],
});
```

This prevents bundling the dependency into your package.

### Modifying Package Scripts

All package scripts use Turbo with `--filter={.}...` pattern:
```json
{
  "scripts": {
    "build": "turbo run _build --filter={.}...",
    "_build": "tsc --noEmit && tsdown"
  }
}
```

- Public-facing scripts (e.g., `build`) use Turbo with filters
- Internal scripts (e.g., `_build`) are the actual commands
- The `--filter={.}...` pattern means "this package and its dependencies"

### Running Checks

**Before committing:**
```bash
pnpm verify
```

This runs:
- Format check (`prettier`)
- Lint (`eslint`)
- Type check (`tsc --noEmit`)
- Build all packages
- Tests
- Export validation (ATTW)
- API validation (API Extractor)

### Adding Custom Entry Points

**⚠️ INTERACTIVE COMMAND - Ask user to run it**

The `pnpm add-entry` command is interactive. Tell the user:
```
"To add a custom entry point (e.g., @restatedev/pkg/utils), please run:
  pnpm add-entry

This will automatically update:
- package.json exports and typesVersions
- tsdown.config.ts entry array
- Root tsconfig.json paths
- API Extractor configs
- Package scripts"
```

## Configuration Patterns

### TypeScript Config Layers

**Root level:**
- `tsconfig.base.json` - Shared compiler options
- `tsconfig.json` - Extends base + path mappings (auto-generated)

**Package level:**
- `tsconfig.json` - Extends root (inherits path mappings)
- `tsconfig.build.json` - Extends base (clean builds, no path mappings)
- `tsconfig.test.json` - For test packages

**Key points:**
- Use `tsconfig.build.json` for building (clean, no external references)
- Use `tsconfig.json` for dev/IDE (includes path mappings)
- Path mappings are auto-generated by `pnpm generate:configs`

### Package.json Field Order

Standard order for consistency:
```json
{
  "name": "@scope/package-name",
  "version": "0.0.0",
  "description": "...",
  "author": "...",
  "license": "MIT",
  "homepage": "...",
  "repository": {...},
  "bugs": {...},
  "private": true,
  "type": "module",
  "main": "...",
  "module": "...",
  "types": "...",
  "exports": {...},
  "files": [...],
  "publishConfig": {...},
  "scripts": {...},
  "dependencies": {...},
  "devDependencies": {...}
}
```

### File Headers

All TypeScript files should include a copyright header:
```typescript
/*
 * Copyright (c) TODO: Add copyright holder
 *
 * This file is part of TODO: Add project name,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * TODO: Add repository URL
 */
```

Templates already include this header. Update the TODOs when customizing for your project.

## Development Workflow

### Typical Development Session

```bash
# Start type checking for all libs
pnpm dev

# In another terminal, run tests in watch mode
pnpm test:watch

# In another terminal, run an example
pnpm examples:dev my-example
```

Changes to lib source files are immediately reflected in tests and examples - no build required!

### Before Committing

```bash
# Run all checks (same as CI)
pnpm verify

# If checks pass, commit
git add .
git commit -m "Your message"
```

### Release Process

**⚠️ Note: `pnpm changeset` is interactive**

**Automatic workflow (recommended):**
1. Ask user to create changeset: "Please run `pnpm changeset` to create a changeset for your changes"
2. User commits the changeset and merges to main
3. GitHub Actions automatically creates tag, release, and publishes

**Manual workflow (hotfixes):**
1. Ask user to create changeset: "Please run `pnpm changeset`"
2. User or agent runs: `pnpm version` (not interactive - safe to run)
3. Commit and tag: `git tag v1.2.3 && git push origin v1.2.3`
4. Create GitHub release (triggers publish)

**Never run `pnpm release` locally** - let CI handle publishing.

## Troubleshooting

### Type Errors in IDE

If you see import errors:
1. Check if `tsconfig.json` in root has path mappings
2. Regenerate configs: `pnpm generate:configs`
3. Restart TypeScript server in your IDE

### Build Failures

If builds fail:
1. Clean artifacts: `pnpm clean`
2. Clear Turbo cache: `pnpm clean:cache`
3. Reinstall dependencies: `rm -rf node_modules pnpm-lock.yaml && pnpm install`

### ATTW Errors

If export validation fails:
- Check that all entry points are listed in `package.json` exports
- Verify `typesVersions` is configured for Node 10 compatibility
- Ensure built files exist in `dist/`

### API Extractor Errors

If API validation fails:
- Export any types used in public APIs
- Check that `api-extractor.json` exists for each entry point
- Verify `tsconfig.build.json` is being used

## Best Practices

1. **Always use generators** for creating/modifying packages and entry points
2. **Run `pnpm verify`** before committing
3. **Use workspace dependencies** with `@workspace:*` protocol
4. **Add external declarations** in tsdown config for publishable dependencies
5. **Keep private libs simple** - they're bundled automatically
6. **Test from source in dev** - use built output for CI/production validation
7. **Follow the package.json field order** for consistency
8. **Include copyright headers** in all TypeScript files
9. **Use PNPM catalogs** for shared/peer dependencies
10. **Let CI handle publishing** - never publish locally

## File Generation

When creating new TypeScript files outside of the generators, remember to:
1. Include the copyright header
2. Follow existing naming conventions
3. Export from index.ts if it's a public API
4. Add tests in the appropriate test package

## Questions?

See [DEVELOPMENT.md](./DEVELOPMENT.md) for comprehensive documentation.
