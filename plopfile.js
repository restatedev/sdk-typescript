import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export default function (plop) {
  plop.setHelper("eq", (a, b) => a === b);

  plop.setGenerator("package", {
    description: "Create a new package",
    prompts: [
      {
        type: "list",
        name: "type",
        message: "Package type:",
        choices: ["lib", "test", "example"],
      },
      {
        type: "input",
        name: "name",
        message: "Package name:",
        validate: (input) => {
          if (!input) return "Package name is required";
          if (!/^[a-z0-9-]+$/.test(input))
            return "Package name must be lowercase with hyphens only";
          return true;
        },
      },
      {
        type: "confirm",
        name: "publishable",
        message: "Should this package be publishable to npm?",
        default: true,
        when: (answers) => answers.type === "lib",
      },
    ],
    actions: (data) => {
      const actions = [];
      const subDir =
        data.type === "lib"
          ? "libs"
          : data.type === "example"
            ? "examples"
            : "tests";
      const packageDir = `packages/${subDir}/{{dashCase name}}`;

      // Set private flag based on publishable answer
      if (data.type === "lib") {
        data.private = !data.publishable;
      } else {
        // Force private for test and example packages
        data.private = true;
      }

      actions.push(
        {
          type: "add",
          path: `${packageDir}/package.json`,
          templateFile: ".templates/package.json.hbs",
        },
        {
          type: "add",
          path: `${packageDir}/tsconfig.json`,
          templateFile: ".templates/tsconfig.json.hbs",
        },
        {
          type: "add",
          path:
            data.type === "test"
              ? `${packageDir}/src/index.test.ts`
              : `${packageDir}/src/index.ts`,
          templateFile: ".templates/index.ts.hbs",
        }
      );

      // Add build/test config based on type
      if (data.type === "lib" && !data.private) {
        // Only public libs need tsconfig.build.json
        actions.push({
          type: "add",
          path: `${packageDir}/tsconfig.build.json`,
          templateFile: ".templates/tsconfig.build.json.hbs",
        });
      } else if (data.type === "example") {
        actions.push({
          type: "add",
          path: `${packageDir}/tsconfig.build.json`,
          templateFile: ".templates/tsconfig.build.json.hbs",
        });
      } else if (data.type === "test") {
        actions.push({
          type: "add",
          path: `${packageDir}/tsconfig.test.json`,
          templateFile: ".templates/tsconfig.test.json.hbs",
        });
      }

      if (data.type === "lib") {
        // Only add build-related files for public (non-private) libs
        if (!data.private) {
          actions.push(
            {
              type: "add",
              path: `${packageDir}/tsdown.config.ts`,
              templateFile: ".templates/tsdown.config.ts.hbs",
            },
            {
              type: "add",
              path: `${packageDir}/api-extractor.json`,
              templateFile: ".templates/api-extractor.json.hbs",
            }
          );
        }

        actions.push({
          type: "add",
          path: `${packageDir}/README.md`,
          templateFile: ".templates/README.md.hbs",
        });
      }

      // Generate configs after creating packages
      actions.push(() => {
        try {
          execSync("pnpm generate:configs", { stdio: "inherit" });
          return "✓ Generated example configs";
        } catch (error) {
          console.error(error);
          return "⚠ Failed to generate configs - run 'pnpm generate:configs' manually";
        }
      });

      // Install dependencies
      actions.push(() => {
        try {
          execSync("pnpm install", { stdio: "inherit" });
          return "✓ Installed dependencies";
        } catch (error) {
          console.error(error);
          return "⚠ Failed to install dependencies";
        }
      });

      return actions;
    },
  });

  plop.setGenerator("delete-package", {
    description: "Remove a package",
    prompts: [
      {
        type: "list",
        name: "package",
        message: "Select package to remove:",
        choices: () => {
          const packages = [];
          const dirs = [
            { path: "packages/libs", prefix: "libs/" },
            { path: "packages/tests", prefix: "tests/" },
            { path: "packages/examples", prefix: "examples/" },
          ];

          for (const dir of dirs) {
            const fullPath = path.join(process.cwd(), dir.path);
            if (fs.existsSync(fullPath)) {
              const items = fs.readdirSync(fullPath);
              for (const item of items) {
                const itemPath = path.join(fullPath, item);
                if (fs.statSync(itemPath).isDirectory()) {
                  packages.push({
                    name: `${dir.prefix}${item}`,
                    value: itemPath,
                  });
                }
              }
            }
          }

          if (packages.length === 0) {
            return [{ name: "No packages found", value: null }];
          }

          return packages;
        },
      },
      {
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to remove this package?",
        default: false,
        when: (answers) => answers.package !== null,
      },
    ],
    actions: (data) => {
      if (!data.package) {
        return [];
      }

      if (!data.confirm) {
        return [];
      }

      return [
        (answers) => {
          try {
            if (fs.existsSync(answers.package)) {
              // Read package.json to get the package name before deleting
              const pkgJsonPath = path.join(answers.package, "package.json");
              let packageName = null;

              if (fs.existsSync(pkgJsonPath)) {
                const pkgJson = JSON.parse(
                  fs.readFileSync(pkgJsonPath, "utf-8")
                );
                packageName = pkgJson.name;
              }

              // Remove the package directory
              fs.rmSync(answers.package, { recursive: true, force: true });

              // Clean up root tsconfig.json paths for this package
              if (packageName) {
                const rootTsconfigPath = path.join(
                  process.cwd(),
                  "tsconfig.json"
                );
                if (fs.existsSync(rootTsconfigPath)) {
                  const tsconfig = JSON.parse(
                    fs.readFileSync(rootTsconfigPath, "utf-8")
                  );

                  if (
                    tsconfig.compilerOptions &&
                    tsconfig.compilerOptions.paths
                  ) {
                    const paths = tsconfig.compilerOptions.paths;
                    const keysToDelete = [];

                    // Find all path keys that start with the package name
                    for (const key of Object.keys(paths)) {
                      if (
                        key === packageName ||
                        key.startsWith(`${packageName}/`)
                      ) {
                        keysToDelete.push(key);
                      }
                    }

                    // Delete the keys
                    for (const key of keysToDelete) {
                      delete paths[key];
                    }

                    // Write back the updated tsconfig
                    fs.writeFileSync(
                      rootTsconfigPath,
                      JSON.stringify(tsconfig, null, 2) + "\n"
                    );

                    if (keysToDelete.length > 0) {
                      return `✓ Removed package at ${answers.package} and cleaned up ${keysToDelete.length} path mapping(s)`;
                    }
                  }
                }
              }

              return `✓ Removed package at ${answers.package}`;
            }
            throw new Error(`Package not found at ${answers.package}`);
          } catch (error) {
            throw new Error(`Failed to remove package: ${error.message}`);
          }
        },
        () => {
          try {
            execSync("pnpm generate:configs", { stdio: "inherit" });
            return "✓ Updated example configs";
          } catch (error) {
            console.error(error);
            return "⚠ Failed to update configs - run 'pnpm generate:configs' manually";
          }
        },
        () => {
          try {
            execSync("pnpm install", { stdio: "inherit" });
            return "✓ Installed dependencies";
          } catch (error) {
            console.error(error);
            return "⚠ Failed to install dependencies";
          }
        },
      ];
    },
  });

  plop.setGenerator("add-entry", {
    description: "Add a custom entry point to a public lib",
    prompts: [
      {
        type: "list",
        name: "package",
        message: "Select a public lib package:",
        choices: () => {
          const packages = [];
          const libsPath = path.join(process.cwd(), "packages/libs");

          if (fs.existsSync(libsPath)) {
            const items = fs.readdirSync(libsPath);
            for (const item of items) {
              const itemPath = path.join(libsPath, item);
              if (fs.statSync(itemPath).isDirectory()) {
                const pkgJsonPath = path.join(itemPath, "package.json");
                if (fs.existsSync(pkgJsonPath)) {
                  const pkgJson = JSON.parse(
                    fs.readFileSync(pkgJsonPath, "utf-8")
                  );
                  // Only show public libs (non-private packages)
                  if (!pkgJson.private) {
                    packages.push({
                      name: `${pkgJson.name} (${item})`,
                      value: {
                        path: itemPath,
                        name: item,
                        pkgName: pkgJson.name,
                      },
                    });
                  }
                }
              }
            }
          }

          if (packages.length === 0) {
            return [{ name: "No public lib packages found", value: null }];
          }

          return packages;
        },
      },
      {
        type: "input",
        name: "entryName",
        message: "Entry point name (e.g., 'utils' for './utils' export):",
        when: (answers) => answers.package !== null,
        validate: (input) => {
          if (!input) return "Entry point name is required";
          if (!/^[a-z0-9-/]+$/.test(input))
            return "Entry point name must be lowercase with hyphens and slashes only";
          if (input === "index" || input === ".")
            return "Cannot use 'index' or '.' as entry name (already the main entry)";
          return true;
        },
      },
    ],
    actions: (data) => {
      if (!data.package) {
        return [];
      }

      const actions = [];
      const packagePath = data.package.path;
      const entryPath = data.entryName.replace(/\//g, path.sep);
      const entryDir = path.dirname(entryPath);
      const entryFileName = path.basename(entryPath);

      // 1. Create the source file
      actions.push({
        type: "add",
        path: `${packagePath}/src/${entryPath}.ts`,
        template: `// {{entryName}} entry point
export function placeholder() {
  return "TODO: Implement {{entryName}}";
}
`,
      });

      // 2. Update package.json exports and typesVersions
      actions.push((answers) => {
        const pkgJsonPath = path.join(packagePath, "package.json");
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

        if (!pkgJson.exports) {
          pkgJson.exports = {};
        }

        // Add the new export
        const exportKey = `./${answers.entryName}`;
        pkgJson.exports[exportKey] = {
          import: `./dist/${answers.entryName}.js`,
          require: `./dist/${answers.entryName}.cjs`,
        };

        // Add typesVersions for Node10 compatibility (fixes ATTW resolution)
        if (!pkgJson.typesVersions) {
          pkgJson.typesVersions = {
            "*": {},
          };
        }
        if (!pkgJson.typesVersions["*"]) {
          pkgJson.typesVersions["*"] = {};
        }

        // Add entry to typesVersions
        pkgJson.typesVersions["*"][answers.entryName] = [
          `./dist/${answers.entryName}.d.ts`,
        ];

        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
        return `✓ Updated package.json exports and typesVersions`;
      });

      // 3. Update tsdown.config.ts
      actions.push((answers) => {
        const tsdownConfigPath = path.join(packagePath, "tsdown.config.ts");
        if (!fs.existsSync(tsdownConfigPath)) {
          return "⚠ tsdown.config.ts not found, skipping";
        }

        let content = fs.readFileSync(tsdownConfigPath, "utf-8");

        // Find the entry array and add the new entry
        const entryRegex = /entry:\s*\[(.*?)\]/s;
        const match = content.match(entryRegex);

        if (match) {
          const entries = match[1];
          const newEntry = `"src/${answers.entryName}.ts"`;

          // Check if entry already exists
          if (entries.includes(newEntry)) {
            return `⚠ Entry ${newEntry} already exists in tsdown.config.ts`;
          }

          // Add new entry
          const updatedEntries = entries.trim()
            ? `${entries.trim()}, ${newEntry}`
            : newEntry;
          content = content.replace(entryRegex, `entry: [${updatedEntries}]`);

          fs.writeFileSync(tsdownConfigPath, content);
          return `✓ Updated tsdown.config.ts`;
        } else {
          return "⚠ Could not find entry array in tsdown.config.ts - please update manually";
        }
      });

      // 4. Update root tsconfig.json paths
      actions.push((answers) => {
        const rootTsconfigPath = path.join(process.cwd(), "tsconfig.json");
        if (!fs.existsSync(rootTsconfigPath)) {
          return "⚠ Root tsconfig.json not found, skipping path mapping";
        }

        const tsconfig = JSON.parse(fs.readFileSync(rootTsconfigPath, "utf-8"));

        if (!tsconfig.compilerOptions) {
          tsconfig.compilerOptions = {};
        }
        if (!tsconfig.compilerOptions.paths) {
          tsconfig.compilerOptions.paths = {};
        }

        const pathKey = `${data.package.pkgName}/${answers.entryName}`;
        const pathValue = `./packages/libs/${data.package.name}/src/${answers.entryName}.ts`;

        tsconfig.compilerOptions.paths[pathKey] = [pathValue];

        fs.writeFileSync(
          rootTsconfigPath,
          JSON.stringify(tsconfig, null, 2) + "\n"
        );
        return `✓ Updated root tsconfig.json paths`;
      });

      // 5. Create API Extractor config for the new entry
      actions.push((answers) => {
        const baseApiExtractorPath = path.join(
          packagePath,
          "api-extractor.json"
        );
        if (!fs.existsSync(baseApiExtractorPath)) {
          return "⚠ api-extractor.json not found, skipping API Extractor config creation";
        }

        // Create a config for the new entry point
        const entryBaseName = answers.entryName.replace(/\//g, "-");
        const newConfigPath = path.join(
          packagePath,
          `api-extractor.${entryBaseName}.json`
        );

        const newConfig = {
          extends: "../../../api-extractor.base.json",
          mainEntryPointFilePath: `<projectFolder>/dist/${answers.entryName}.d.ts`,
        };

        fs.writeFileSync(
          newConfigPath,
          JSON.stringify(newConfig, null, 2) + "\n"
        );
        return `✓ Created api-extractor.${entryBaseName}.json`;
      });

      // 6. Update package.json _check:api script to include new entry
      actions.push((answers) => {
        const pkgJsonPath = path.join(packagePath, "package.json");
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

        if (pkgJson.scripts && pkgJson.scripts["_check:api"]) {
          const entryBaseName = answers.entryName.replace(/\//g, "-");
          const currentScript = pkgJson.scripts["_check:api"];

          // Add the new config to the script
          const newScript = `${currentScript} && api-extractor run --local --config api-extractor.${entryBaseName}.json`;

          pkgJson.scripts["_check:api"] = newScript;

          fs.writeFileSync(
            pkgJsonPath,
            JSON.stringify(pkgJson, null, 2) + "\n"
          );
          return `✓ Updated package.json _check:api script`;
        } else {
          return "⚠ _check:api script not found, skipping";
        }
      });

      // 7. Format files
      actions.push(() => {
        try {
          execSync("pnpm format", { stdio: "inherit" });
          return "✓ Formatted files";
        } catch (error) {
          return "⚠ Failed to format - run 'pnpm format' manually";
        }
      });

      // 8. Show next steps
      actions.push((answers) => {
        return `
✓ Successfully added entry point '${answers.entryName}' to ${data.package.pkgName}

📝 Next steps:
  1. Implement your code in packages/libs/${data.package.name}/src/${answers.entryName}.ts
  2. Import it: import { ... } from '${data.package.pkgName}/${answers.entryName}'
  3. Build and verify: pnpm build && pnpm verify

✅ All validation tools will now check this entry point:
   - check:exports ✓ (ATTW validates all exports)
   - check:types ✓ (TypeScript checks all source files)
   - check:api ✓ (API Extractor config created)
`;
      });

      return actions;
    },
  });

  plop.setDefaultInclude({ generators: true });
}
