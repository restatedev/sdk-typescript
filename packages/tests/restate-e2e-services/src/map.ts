// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";
export const MapServiceFQN = "MapObject";

const { asInternal } = restate.internal;

// Resolve the given JSON pointer (RFC 6901), returns undefined if it doesn't resolve.
function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") {
    return document;
  }
  if (!pointer.startsWith("/")) {
    throw new restate.TerminalError(`Invalid JSON pointer ${pointer}`);
  }
  let current = document;
  for (const escapedToken of pointer.slice(1).split("/")) {
    const token = escapedToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return undefined;
      }
      current = current[Number(token)];
    } else if (
      current !== null &&
      typeof current === "object" &&
      Object.hasOwn(current, token)
    ) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

const o = restate.object({
  name: MapServiceFQN,
  handlers: {
    async clearAll(
      ctx: restate.ObjectContext
    ): Promise<Array<{ key: string; value: string }>> {
      const keys = await ctx.stateKeys();
      const entries = [];
      for (const key of keys) {
        const value = await ctx.get<string>(key);
        if (!value) {
          continue;
        }
        entries.push({ key, value });
      }
      ctx.clearAll();
      return entries;
    },

    async get(ctx: restate.ObjectContext, request: string): Promise<string> {
      const value = (await ctx.get<string>(request)) ?? "";
      return value;
    },

    getProject(
      ctx: restate.ObjectContext,
      request: { key: string; pointer: string }
    ): Promise<string> {
      return asInternal(ctx).getProject<string, string>(
        request.key,
        (value) => {
          if (value === null) {
            return "";
          }
          const projected = resolveJsonPointer(
            JSON.parse(value),
            request.pointer
          );
          return projected === undefined ? "" : JSON.stringify(projected);
        }
      );
    },

    set(ctx: restate.ObjectContext, request: { key: string; value: string }) {
      ctx.set(request.key, request.value);
      return Promise.resolve();
    },
  },
});

REGISTRY.addObject(o);
