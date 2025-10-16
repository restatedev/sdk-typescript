/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// The following script injects the current version
// taken from package.json into a src/generated/version.ts
// file.

import * as fs from "node:fs";

//
// compute the relative paths to the package root, which `npm run` always executes fro
//
const packageJsonPath = `./package.json`;
const targetDir = `./src/generated`;
const targetFile = `${targetDir}/version.ts`;

//
// generate version.ts
//
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;
const versionFileContent = `export const SDK_VERSION = '${version}';\n`;
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetFile, versionFileContent);
