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

type ListState = { list: string[] };

export const listObject = object({
  name: "ListObject",
  handlers: {
    *append(value: string) {
      const s = state<ListState>();
      const list = (yield* s.get("list")) ?? [];
      s.set("list", [...list, value]);
    },

    *get() {
      return (yield* sharedState<ListState>().get("list")) ?? [];
    },

    *clear() {
      const s = state<ListState>();
      const result = (yield* s.get("list")) ?? [];
      s.clear("list");
      return result;
    },
  },
  options: {
    handlers: {
      get: { shared: true },
    },
  },
});
