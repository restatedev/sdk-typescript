#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getLibPackages } from "./get-lib-packages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const libPackages = getLibPackages();

// Filter out private source-only packages (no build script)
const buildableLibs = libPackages.filter((pkg) => {
  const pkgJsonPath = path.join(pkg.path, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  return !pkgJson.private || (pkgJson.scripts && pkgJson.scripts.build);
});

// Helper to get all packages in a directory
function getPackagesInDir(dir) {
  const packages = [];
  if (fs.existsSync(dir)) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      if (fs.statSync(itemPath).isDirectory()) {
        packages.push(itemPath);
      }
    }
  }
  return packages;
}

// Update root tsconfig.json with paths for IDE resolution
const rootTsconfigPath = path.join(rootDir, "tsconfig.json");
const rootTsconfig = JSON.parse(fs.readFileSync(rootTsconfigPath, "utf-8"));

const rootPaths = {};
for (const pkg of libPackages) {
  const relativePath = path.relative(rootDir, pkg.srcPath);
  rootPaths[pkg.name] = [relativePath];

  // Add subpath exports from package.json
  const pkgJsonPath = path.join(pkg.path, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

  if (pkgJson.exports) {
    for (const [exportKey, exportValue] of Object.entries(pkgJson.exports)) {
      // Skip main entry (.) and package.json
      if (exportKey === "." || exportKey === "./package.json") {
        continue;
      }

      // Get import path from export definition
      const importPath =
        typeof exportValue === "string" ? exportValue : exportValue.import;

      if (importPath) {
        // Convert dist path to src path
        const srcPath = importPath
          .replace(/^\.\/dist\//, "./src/")
          .replace(/\.c?js$/, ".ts");

        const fullPath = path.join(pkg.path, srcPath);

        if (fs.existsSync(fullPath)) {
          const subpathKey = exportKey.startsWith("./")
            ? `${pkg.name}${exportKey.slice(1)}`
            : `${pkg.name}/${exportKey}`;

          rootPaths[subpathKey] = [path.relative(rootDir, fullPath)];
        }
      }
    }
  }
}

if (!rootTsconfig.compilerOptions) {
  rootTsconfig.compilerOptions = {};
}

rootTsconfig.compilerOptions.baseUrl = ".";
rootTsconfig.compilerOptions.paths = rootPaths;

// Add project references to all packages in root tsconfig
const rootReferences = [];

// Add lib packages
for (const pkg of buildableLibs) {
  rootReferences.push({ path: path.relative(rootDir, pkg.path) });
}

// Add test packages
const testPackages = getPackagesInDir(path.join(rootDir, "packages/tests"));
for (const pkgPath of testPackages) {
  rootReferences.push({ path: path.relative(rootDir, pkgPath) });
}

// Add example packages
const examplePackages = getPackagesInDir(
  path.join(rootDir, "packages/examples")
);
for (const pkgPath of examplePackages) {
  rootReferences.push({ path: path.relative(rootDir, pkgPath) });
}

if (rootReferences.length > 0) {
  rootTsconfig.references = rootReferences;
} else {
  delete rootTsconfig.references;
}

fs.writeFileSync(
  rootTsconfigPath,
  JSON.stringify(rootTsconfig, null, 2) + "\n"
);
console.log(`✓ Updated ${path.relative(rootDir, rootTsconfigPath)}`);

// Update lib package tsconfig.build.json references (only for buildable libs)
for (const pkg of buildableLibs) {
  const tsconfigBuildPath = path.join(pkg.path, "tsconfig.build.json");

  if (!fs.existsSync(tsconfigBuildPath)) {
    continue;
  }

  const tsconfigBuild = JSON.parse(fs.readFileSync(tsconfigBuildPath, "utf-8"));
  const pkgJsonPath = path.join(pkg.path, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

  // Get workspace dependencies
  const deps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies,
    ...pkgJson.peerDependencies,
  };

  const references = [];
  for (const depName in deps) {
    if (deps[depName].startsWith("workspace:")) {
      // Only add references to buildable libs
      const depPkg = buildableLibs.find((p) => p.name === depName);
      if (depPkg) {
        const relativePath = path.relative(
          pkg.path,
          path.join(depPkg.path, "tsconfig.build.json")
        );
        references.push({ path: relativePath });
      }
    }
  }

  if (references.length > 0) {
    tsconfigBuild.references = references;
  } else {
    delete tsconfigBuild.references;
  }

  fs.writeFileSync(
    tsconfigBuildPath,
    JSON.stringify(tsconfigBuild, null, 2) + "\n"
  );
  console.log(`✓ Updated ${path.relative(rootDir, tsconfigBuildPath)}`);
}

// Update test package tsconfig.test.json references
const testsDir = path.join(rootDir, "packages/tests");
if (fs.existsSync(testsDir)) {
  const tests = fs.readdirSync(testsDir);

  for (const test of tests) {
    const testPath = path.join(testsDir, test);

    if (!fs.statSync(testPath).isDirectory()) {
      continue;
    }

    const tsconfigTestPath = path.join(testPath, "tsconfig.test.json");

    if (!fs.existsSync(tsconfigTestPath)) {
      continue;
    }

    const tsconfigTest = JSON.parse(fs.readFileSync(tsconfigTestPath, "utf-8"));
    const pkgJsonPath = path.join(testPath, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

    // Get workspace dependencies
    const deps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };

    const references = [];
    for (const depName in deps) {
      if (deps[depName].startsWith("workspace:")) {
        // Only add references to buildable libs
        const depPkg = buildableLibs.find((p) => p.name === depName);
        if (depPkg) {
          const relativePath = path.relative(
            testPath,
            path.join(depPkg.path, "tsconfig.build.json")
          );
          references.push({ path: relativePath });
        }
      }
    }

    if (references.length > 0) {
      tsconfigTest.references = references;
    } else {
      delete tsconfigTest.references;
    }

    fs.writeFileSync(
      tsconfigTestPath,
      JSON.stringify(tsconfigTest, null, 2) + "\n"
    );
    console.log(`✓ Updated ${path.relative(rootDir, tsconfigTestPath)}`);
  }
}

console.log(`\n✓ Generated configs successfully`);

// Run prettier to format all modified files
console.log(`\n✓ Running prettier...`);
try {
  const { execSync } = await import("child_process");
  execSync("pnpm format", { cwd: rootDir, stdio: "inherit" });
  console.log(`✓ Formatted files successfully`);
} catch (error) {
  console.error(`✗ Failed to run prettier:`, error.message);
}
