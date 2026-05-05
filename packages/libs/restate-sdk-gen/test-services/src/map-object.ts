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

// MapObject — virtual object that exposes the per-VO state as a key/value map.
// Mirrors sdk-ruby/test-services/services/map_object.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state, sharedState } from "@restatedev/restate-sdk-gen";

type Entry = { key: string; value: string };

export const mapObject = restate.object({
  name: "MapObject",
  handlers: {
    set: async (ctx: restate.ObjectContext, entry: Entry): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          state().set(entry.key, entry.value);
        })
      ),

    get: async (
      ctx: restate.ObjectSharedContext,
      key: string
    ): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const v = yield* sharedState().get<string>(key);
          return v ?? "";
        })
      ),

    clearAll: async (ctx: restate.ObjectContext): Promise<Entry[]> =>
      execute(
        ctx,
        gen(function* () {
          const s = state();
          const keys = yield* s.keys();
          const entries: Entry[] = [];
          for (const key of keys) {
            const value = (yield* s.get<string>(key)) ?? "";
            entries.push({ key, value });
            s.clear(key);
          }
          return entries;
        })
      ),
  },
});
