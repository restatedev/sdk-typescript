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
import { clients, greeter, awakeableHolder } from "./08-clients.js";
import { blockAndWaitWorkflow } from "./09-workflows.js";

restate.serve({
  services: [
    basics,
    spawnSvc,
    timeout,
    retry,
    saga,
    cancel,
    counter,
    clients,
    greeter,
    awakeableHolder,
    blockAndWaitWorkflow,
  ],
});
