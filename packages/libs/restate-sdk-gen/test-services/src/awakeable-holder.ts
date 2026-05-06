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

import * as restate from "@restatedev/restate-sdk";
import {
  object,
  state,
  sharedState,
  resolveAwakeable,
} from "@restatedev/restate-sdk-gen";

type HolderState = { id: string };

export const awakeableHolder = object({
  name: "AwakeableHolder",
  handlers: {
    *hold(id: string) {
      state<HolderState>().set("id", id);
    },

    *hasAwakeable() {
      const id = yield* sharedState<HolderState>().get("id");
      return id != null;
    },

    *unlock(payload: string) {
      const id = yield* state<HolderState>().get("id");
      if (id == null)
        throw new restate.TerminalError("No awakeable is registered");
      resolveAwakeable(id, payload);
    },
  },
  options: {
    handlers: {
      hasAwakeable: { shared: true },
    },
  },
});
