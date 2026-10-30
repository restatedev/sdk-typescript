/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFile, readEnvVar } from "./env_file.js";

const VARS = ["RESTATE_TEST_ENV_A", "RESTATE_TEST_ENV_B", "RESTATE_TEST_EMPTY"];
afterEach(() => {
  for (const name of VARS) delete process.env[name];
});

describe("loadEnvFile", () => {
  it("loads a dotenv file without overriding, reports a missing file, treats empty as unset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-core-env-"));
    try {
      const file = path.join(dir, ".env");
      fs.writeFileSync(
        file,
        "RESTATE_TEST_ENV_A=from_file\nRESTATE_TEST_ENV_B=from_file\nRESTATE_TEST_EMPTY=\n"
      );
      process.env.RESTATE_TEST_ENV_A = "from_process";
      expect(loadEnvFile(file)).toBe("loaded");
      expect(process.env.RESTATE_TEST_ENV_A).toBe("from_process");
      expect(process.env.RESTATE_TEST_ENV_B).toBe("from_file");
      expect(readEnvVar("RESTATE_TEST_ENV_B")).toBe("from_file");
      expect(readEnvVar("RESTATE_TEST_EMPTY")).toBeUndefined();
      expect(readEnvVar("RESTATE_TEST_UNSET_FOR_SURE")).toBeUndefined();
      expect(loadEnvFile(path.join(dir, "nope.env"))).toBe("missing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
