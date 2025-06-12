// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";

import "./interpreter/entry_point.js";
import "./awakeable_holder.js";
import "./counter.js";
import "./event_handler.js";
import "./list.js";
import "./map.js";
import "./cancel_test.js";
import "./non_determinism.js";
import "./failing.js";
import "./side_effect.js";
import "./workflow.js";
import "./proxy.js";
import "./test_utils.js";
import "./kill.js";
import "./virtual_object_command_interpreter.js";
import * as http2 from "http2";
import * as heapdump from "heapdump";
import path from "path";

// Optional: trigger a heap snapshot on signal
process.on("SIGUSR2", () => {
  const filename = path.join("/opt", `heap-${Date.now()}.heapsnapshot`);
  // eslint-disable-next-line no-console
  console.log(`Writing snapshot to ${filename}...`);
  heapdump.writeSnapshot(filename, (err, filename) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    // eslint-disable-next-line no-console
    else console.log(`Heap snapshot written to ${filename}`);
  });
});

import { REGISTRY } from "./services.js";

if (!process.env.SERVICES) {
  throw new Error("Cannot find SERVICES env");
}
const fqdns = new Set(process.env.SERVICES.split(","));
const endpoint = restate.endpoint();
REGISTRY.register(fqdns, endpoint);

const settings: http2.Settings = {};
if (process.env.MAX_CONCURRENT_STREAMS) {
  settings.maxConcurrentStreams = parseInt(process.env.MAX_CONCURRENT_STREAMS);
}

if (process.env.E2E_REQUEST_SIGNING) {
  endpoint.withIdentityV1(...process.env.E2E_REQUEST_SIGNING.split(","));
}

let INFLIGHT_REQUESTS = 0;
let ACTIVE_SESSIONS = 0;

const handler = endpoint.http2Handler();
const server = http2.createServer((req, res) => {
  INFLIGHT_REQUESTS++;
  res.once("close", () => {
    INFLIGHT_REQUESTS--;
  });
  handler(req, res);
});

server.on("session", (session) => {
  ACTIVE_SESSIONS++;
  console.log("New session opened. Total:", ACTIVE_SESSIONS);

  session.on("close", () => {
    --ACTIVE_SESSIONS;
    console.log("Session closed. Total:", ACTIVE_SESSIONS);
  });
});

setInterval(() => {
  // eslint-disable-next-line no-console
  console.log(
    `${new Date().toISOString()}: Inflight requests: ${INFLIGHT_REQUESTS}`
  );
}, 30 * 1000);

server.updateSettings(settings);

server.listen(parseInt(process.env.PORT || "9080"));
