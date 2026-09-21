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

import { describe, expect, test } from "vitest";
import { gen, iface } from "../src/index.js";

// A shared contract carrying service- and handler-level documentation/metadata.
const documented = iface.service(
  "documented",
  {
    greet: iface.json<string, string>({
      description: "Greets the caller",
      metadata: { visibility: "public" },
    }),
  },
  { description: "A documented service", metadata: { owner: "team-a" } }
);

describe("gen iface.implement — documentation/metadata", () => {
  test("folds contract docs into the generated definition", () => {
    const def = iface.implement(documented, {
      handlers: {
        greet: (name: string) =>
          gen(function* () {
            return name;
          }),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = def as any;
    expect(d.description).toBe("A documented service");
    expect(d.metadata).toEqual({ owner: "team-a" });
  });
});
