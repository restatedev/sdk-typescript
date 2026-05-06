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

import { object, state, sharedState } from "@restatedev/restate-sdk-gen";

type Entry = { key: string; value: string };

export const mapObject = object({
  name: "MapObject",
  handlers: {
    *set(entry: Entry) {
      state().set(entry.key, entry.value);
    },

    *get(k: string) {
      const v = yield* sharedState().get<string>(k);
      return v ?? "";
    },

    *clearAll() {
      const s = state();
      const keys = yield* s.keys();
      const entries: Entry[] = [];
      for (const k of keys) {
        const value = (yield* s.get<string>(k)) ?? "";
        entries.push({ key: k, value });
        s.clear(k);
      }
      return entries;
    },
  },
  options: {
    handlers: {
      get: { shared: true },
    },
  },
});
