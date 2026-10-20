/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable @typescript-eslint/require-await */

import * as restate from "../src/index.js";
import { EndpointBuilder } from "../src/endpoint/endpoint.js";
import type { DefaultServiceOptions } from "../src/index.js";
import { describe, expect, it } from "vitest";

function explicitRecoveryOf(
  definition: restate.VirtualObjectDefinition<string, unknown>,
  handlerName: string,
  defaultServiceOptions?: DefaultServiceOptions
): boolean | undefined {
  const builder = new EndpointBuilder();
  builder.bind(definition);
  if (defaultServiceOptions) {
    builder.setDefaultServiceOptions(defaultServiceOptions);
  }
  return builder.build().components.get(definition.name)?.handlerMatching({
    type: "invoke",
    componentName: definition.name,
    handlerName,
  })?.executionOptions.explicitRecovery;
}

const handlers = {
  exclusive: async (ctx: restate.ObjectContext) => {
    ctx.set("a", 1);
  },
  shared: restate.handlers.object.shared(
    async (ctx: restate.ObjectSharedContext) => ctx.get<number>("a")
  ),
};

describe("explicitRecovery", () => {
  it("is off by default", () => {
    const counter = restate.object({ name: "counter", handlers });

    expect(explicitRecoveryOf(counter, "exclusive")).toBeUndefined();
    expect(explicitRecoveryOf(counter, "shared")).toBeUndefined();
  });

  it("applies to every handler from the service options", () => {
    const counter = restate.object({
      name: "counter",
      handlers,
      options: {
        ...restate.internal.explicitRecovery(),
        enableLazyState: true,
      },
    });

    expect(explicitRecoveryOf(counter, "exclusive")).toBe(true);
    expect(explicitRecoveryOf(counter, "shared")).toBe(true);
  });

  it("applies to a single handler from its options", () => {
    const counter = restate.object({
      name: "counter",
      handlers: {
        ...handlers,
        recovering: restate.handlers.object.exclusive(
          { ...restate.internal.explicitRecovery() },
          async (ctx: restate.ObjectContext) => {
            ctx.clear("a");
          }
        ),
      },
    });

    expect(explicitRecoveryOf(counter, "recovering")).toBe(true);
    expect(explicitRecoveryOf(counter, "exclusive")).toBeUndefined();
  });

  it("applies from the default service options", () => {
    const counter = restate.object({ name: "counter", handlers });

    expect(
      explicitRecoveryOf(counter, "exclusive", {
        ...restate.internal.explicitRecovery(),
      })
    ).toBe(true);
  });
});
