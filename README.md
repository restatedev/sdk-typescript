# My New Monorepo

A TypeScript monorepo with comprehensive tooling for building, testing, and publishing libraries.

## Features

- 📦 PNPM Workspaces with catalogs
- 🏗️ TypeScript Project References
- ⚡ Fast builds with tsdown
- 🧪 Vitest for testing
- 🎨 ESLint & Prettier
- 📝 Changesets for versioning
- 🤖 GitHub Actions CI/CD
- 🚀 Turbo for smart caching

## Quick Start

```bash
# Install dependencies
pnpm install

# Create your first package
pnpm new

# Start dev mode
pnpm dev

# Build lib packages
pnpm build

# Build everything (libs + examples)
pnpm build:all

# Run tests
pnpm test

# Run all checks
pnpm verify
```

## Package Management

### Create a Package

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

### Delete a Package

```bash
pnpm delete
```

Select a package to remove. Dependencies and TypeScript path mappings will be automatically cleaned up.

### Add Custom Entry Points

```bash
pnpm add-entry
```

Add subpath exports to a public lib (e.g., `@restatedev/my-lib/utils`). This automatically:
- Creates the source file
- Updates package.json exports and typesVersions
- Configures tsdown, API Extractor, and TypeScript paths
- Ensures all validation tools work with the new entry

## Documentation

See [DEVELOPMENT.md](./DEVELOPMENT.md) for complete documentation on:
- Package types and structure
- Managing dependencies
- Development workflow
- Testing and building
- Publishing and releases
- GitHub Actions setup
