import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";

const isWatch =
  process.argv.includes("--watch") || process.argv.includes("watch");

function getLibAliases() {
  const aliases: Record<string, string> = {};
  const libDir = path.resolve(__dirname, "packages/libs");

  if (!fs.existsSync(libDir)) {
    return aliases;
  }

  const packages = fs.readdirSync(libDir);

  for (const pkg of packages) {
    const pkgPath = path.join(libDir, pkg);
    const pkgJsonPath = path.join(pkgPath, "package.json");

    if (!fs.statSync(pkgPath).isDirectory() || !fs.existsSync(pkgJsonPath)) {
      continue;
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

    if (!pkgJson.name) {
      continue;
    }

    if (pkgJson.exports?.["."]) {
      const exportKeys = Object.keys(pkgJson.exports).sort((a, b) =>
        b.localeCompare(a)
      );

      for (const key of exportKeys) {
        const exportValue = pkgJson.exports[key];
        const importPath =
          typeof exportValue === "string" ? exportValue : exportValue.import;

        const entryPoint = path.join(
          pkgPath,
          importPath.replace(/^\.\/dist\//, "./src/").replace(/\.c?js$/, ".ts")
        );

        if (fs.existsSync(entryPoint)) {
          const aliasKey =
            key === "." ? pkgJson.name : `${pkgJson.name}${key.slice(1)}`;
          aliases[aliasKey] = entryPoint;
        }
      }
    } else if (pkgJson.main) {
      const entryPoint = path.join(
        pkgPath,
        pkgJson.main.replace(/^\.\/dist\//, "./src/").replace(/\.c?js$/, ".ts")
      );

      if (fs.existsSync(entryPoint)) {
        aliases[pkgJson.name] = entryPoint;
      }
    }
  }

  return aliases;
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
  },
  ...(isWatch && {
    resolve: {
      alias: getLibAliases(),
    },
  }),
});
