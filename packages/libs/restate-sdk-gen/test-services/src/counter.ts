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
  handlerRequest,
  state,
  sharedState,
} from "@restatedev/restate-sdk-gen";

type CounterState = { counter: number };

export const counterObject = object({
  name: "Counter",
  handlers: {
    *reset() {
      state<CounterState>().clear("counter");
    },

    *get() {
      return (yield* sharedState<CounterState>().get("counter")) ?? 0;
    },

    *add(addend: number) {
      const s = state<CounterState>();
      const oldValue = (yield* s.get("counter")) ?? 0;
      const newValue = oldValue + addend;
      s.set("counter", newValue);
      return { oldValue, newValue };
    },

    *addThenFail(addend: number) {
      const s = state<CounterState>();
      const oldValue = (yield* s.get("counter")) ?? 0;
      s.set("counter", oldValue + addend);
      throw new restate.TerminalError(handlerRequest().key!);
    },
  },
  options: {
    handlers: {
      get: { shared: true },
    },
  },
});
