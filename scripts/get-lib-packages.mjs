#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export function getLibPackages() {
  const packages = [];
  const libDir = path.join(rootDir, "packages/libs");

  if (!fs.existsSync(libDir)) {
    return packages;
  }

  const items = fs.readdirSync(libDir);

  for (const item of items) {
    const pkgPath = path.join(libDir, item);
    const pkgJsonPath = path.join(pkgPath, "package.json");

    if (fs.statSync(pkgPath).isDirectory() && fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const srcIndex = path.join(pkgPath, "src/index.ts");

      if (fs.existsSync(srcIndex)) {
        packages.push({
          name: pkgJson.name,
          path: pkgPath,
          srcPath: srcIndex,
        });
      }
    }
  }

  return packages;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const packages = getLibPackages();
  console.log(JSON.stringify(packages, null, 2));
}
