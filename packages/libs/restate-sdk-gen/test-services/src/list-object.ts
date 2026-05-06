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

// ListObject — virtual object that owns a single list value.
// Mirrors sdk-ruby/test-services/services/list_object.rb.

import * as restate from "@restatedev/restate-sdk";
import { gen, execute, state } from "@restatedev/restate-sdk-gen";

const listState = state({ list: { default: [] as string[] } });

export const listObject = restate.object({
  name: "ListObject",
  handlers: {
    append: async (ctx: restate.ObjectContext, value: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const list = yield* listState.list.get();
          listState.list.set([...list, value]);
        })
      ),

    get: async (ctx: restate.ObjectSharedContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          return yield* listState.list.get();
        })
      ),

    clear: async (ctx: restate.ObjectContext): Promise<string[]> =>
      execute(
        ctx,
        gen(function* () {
          const result: string[] = yield* listState.list.get();
          listState.list.clear();
          return result;
        })
      ),
  },
});
