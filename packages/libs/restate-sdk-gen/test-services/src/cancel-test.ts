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
  client,
  call,
  state,
  sharedState,
  awakeable,
  sleep,
} from "@restatedev/restate-sdk-gen";
import { awakeableHolder } from "./awakeable-holder.js";

type RunnerState = { state: boolean };

export const cancelTestRunner = object({
  name: "CancelTestRunner",
  handlers: {
    *startTest(op: string) {
      try {
        yield* call<string, void>({
          service: "CancelTestBlockingService",
          method: "block",
          key: handlerRequest().key!,
          parameter: op,
          inputSerde: restate.serde.json,
        });
      } catch (e) {
        if (e instanceof restate.TerminalError && e.code === 409) {
          state<RunnerState>().set("state", true);
          return;
        }
        throw e;
      }
    },

    *verifyTest() {
      const v = yield* sharedState<RunnerState>().get("state");
      return v === true;
    },
  },
  options: {
    handlers: {
      verifyTest: { shared: true },
    },
  },
});

export const cancelTestBlockingService = object({
  name: "CancelTestBlockingService",
  handlers: {
    *block(op: string) {
      const { id, promise } = awakeable<string>();
      yield* client(awakeableHolder, handlerRequest().key!).hold(id);
      yield* promise;

      switch (op) {
        case "CALL":
          yield* call<string, void>({
            service: "CancelTestBlockingService",
            method: "block",
            key: handlerRequest().key!,
            parameter: op,
            inputSerde: restate.serde.json,
          });
          break;
        case "SLEEP":
          yield* sleep(1024 * 24 * 60 * 60 * 1000);
          break;
        case "AWAKEABLE": {
          const { promise: p2 } = awakeable<string>();
          yield* p2;
          break;
        }
      }
    },

    *isUnlocked() {},
  },
});
