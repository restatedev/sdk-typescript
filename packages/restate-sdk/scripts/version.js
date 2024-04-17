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

const fs = require("node:fs");
const path = require("node:path");

//
// figure out where we are
//
const cwd = path.dirname(__filename);

//
// compute the relative paths to this script
//
const packageJsonPath = `${cwd}/../package.json`;
const targetDir = `${cwd}/../src/generated`;
const targetFile = `${targetDir}/version.ts`;

//
// generate version.ts
//
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;
const versionFileContent = `export const SDK_VERSION = '${version}';\n`;
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetFile, versionFileContent);
