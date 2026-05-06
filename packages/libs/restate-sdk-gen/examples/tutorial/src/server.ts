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

// Tutorial entry point.
//
// One Restate endpoint, nine services — each a tier of the user guide:
//
//   /basics            — gen, run, sequential, all, race, select
//   /spawn             — spawn for sub-workflows + recursive spawn
//   /timeout           — select(work, sleep) for soft deadlines
//   /retry             — run with maxRetryAttempts + TerminalError fallback
//   /saga              — try / catch with journaled compensation
//   /cancel            — cooperative stop via Channel<void>; invocation-cancel
//                        catch with cleanup
//   /counter           — virtual-object state (typed, get/add/reset)
//   /clients           — typed service/object clients + awakeable cross-handler
//                        (also: /greeter, /awakeableHolder)
//   /blockAndWait      — workflow with a durable promise
//
// See ../README.md for curl invocations grouped by tier.

import * as restate from "@restatedev/restate-sdk";
import { basics } from "./01-basics.js";
import { spawnSvc } from "./02-spawn.js";
import { timeout } from "./03-timeout.js";
import { retry } from "./04-retry.js";
import { saga } from "./05-saga.js";
import { cancel } from "./06-cancel.js";
import { counter } from "./07-state.js";
import { clientsSvc, greeter, awakeableHolder } from "./08-clients.js";
import { blockAndWaitWorkflow } from "./09-workflows.js";
import { ifaceServices } from "./10-ifaces.js";
import { userService, echoService } from "./11-serdes.js";

restate.serve({
  services: [
    basics,
    spawnSvc,
    timeout,
    retry,
    saga,
    cancel,
    counter,
    clientsSvc,
    greeter,
    awakeableHolder,
    blockAndWaitWorkflow,
    ...ifaceServices,
    userService,
    echoService,
  ],
});
