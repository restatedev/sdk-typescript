// Test-services entry point.
//
// One Restate endpoint binding every test service this package ships.
// The sdk-test-suite container starts this binary with SERVICES set to a
// comma-separated list of service names; we filter `ALL_SERVICES` to
// register only those (matching the Ruby/TS reference harnesses).
//
// PORT defaults to 9080. E2E_REQUEST_SIGNING (comma-separated key list)
// enables identity verification on the endpoint.

import * as restate from "@restatedev/restate-sdk";
import { awakeableHolder } from "./awakeable-holder.js";
import { blockAndWaitWorkflow } from "./block-and-wait-workflow.js";
import { cancelTestRunner, cancelTestBlockingService } from "./cancel-test.js";
import { counterObject } from "./counter.js";
import { failing } from "./failing.js";
import {
  objectInterpreterL0,
  objectInterpreterL1,
  objectInterpreterL2,
  serviceInterpreterHelper,
} from "./interpreter.js";
import { killTestRunner, killTestSingleton } from "./kill-test.js";
import { listObject } from "./list-object.js";
import { mapObject } from "./map-object.js";
import { nonDeterministic } from "./non-determinism.js";
import { proxy } from "./proxy.js";
import { testUtilsService } from "./test-utils.js";
import { virtualObjectCommandInterpreter } from "./vo-command-interpreter.js";

const ALL_SERVICES = [
  awakeableHolder,
  blockAndWaitWorkflow,
  cancelTestRunner,
  cancelTestBlockingService,
  counterObject,
  failing,
  killTestRunner,
  killTestSingleton,
  listObject,
  mapObject,
  nonDeterministic,
  objectInterpreterL0,
  objectInterpreterL1,
  objectInterpreterL2,
  proxy,
  serviceInterpreterHelper,
  testUtilsService,
  virtualObjectCommandInterpreter,
];

const wanted = process.env.SERVICES?.trim();
const services = wanted
  ? ALL_SERVICES.filter((s) =>
      wanted
        .split(",")
        .map((n) => n.trim())
        .includes(s.name)
    )
  : ALL_SERVICES;

if (services.length === 0) {
  console.error(
    `No services to bind. SERVICES env=${wanted ?? "(unset)"}. ` +
      `Available: ${ALL_SERVICES.map((s) => s.name).join(", ")}`
  );
  process.exit(1);
}

const port = parseInt(process.env.PORT ?? "9080", 10);
const signing = process.env.E2E_REQUEST_SIGNING;

restate.serve({
  services,
  port,
  ...(signing ? { identityKeys: signing.split(",").map((k) => k.trim()) } : {}),
});
