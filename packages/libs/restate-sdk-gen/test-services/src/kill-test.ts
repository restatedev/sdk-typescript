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

import {
  object,
  handlerRequest,
  call,
  awakeable,
  client,
  sendClient,
} from "@restatedev/restate-sdk-gen";
import { awakeableHolder } from "./awakeable-holder.js";

export const killTestRunner = object({
  name: "KillTestRunner",
  handlers: {
    *startCallTree() {
      yield* client(killTestSingleton, handlerRequest().key!).recursiveCall();
    },
  },
});

export const killTestSingleton = object({
  name: "KillTestSingleton",
  handlers: {
    *recursiveCall() {
      const { id, promise } = awakeable<string>();
      sendClient(awakeableHolder, handlerRequest().key!).hold(id);
      yield* promise;
      yield* call<void, void>({
        service: "KillTestSingleton",
        method: "recursiveCall",
        key: handlerRequest().key!,
        parameter: undefined as unknown as void,
      });
    },

    *isUnlocked() {},
  },
});
