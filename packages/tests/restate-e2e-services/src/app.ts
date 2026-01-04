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
  console.log(`Writing snapshot to ${filename}...`);
  heapdump.writeSnapshot(filename, (err, filename) => {
    if (err) {
      console.error(err);
    } else console.log(`Heap snapshot written to ${filename}`);
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
const sessions = new Map();

const handler = endpoint.http2Handler();
const server = http2.createServer((req, res) => {
  INFLIGHT_REQUESTS++;
  res.once("close", () => {
    INFLIGHT_REQUESTS--;
  });
  handler(req, res);
});

server.on("session", (session) => {
  const sessionId = ACTIVE_SESSIONS++;
  const streams = new Set();
  sessions.set(sessionId, streams);

  const handleCloseSession = () => {
    sessions.delete(sessionId);
  };

  session.on("close", handleCloseSession);
  session.on("error", handleCloseSession);

  session.on("stream", (stream) => {
    streams.add(`${sessionId}_${stream.id}`);

    const handleCloseStream = () => {
      streams.delete(`${sessionId}_${stream.id}`);
    };

    stream.on("close", handleCloseStream);
    stream.on("error", handleCloseStream);
  });

  return undefined;
});

setInterval(() => {
  console.log(
    `${new Date().toISOString()}: Inflight requests: ${INFLIGHT_REQUESTS}`
  );
  console.table(
    Array.from(sessions.values()).map((set: Set<string>) => ({
      "#streams": set.size,
    }))
  );
}, 30 * 1000);

server.updateSettings(settings);

const port = parseInt(process.env.PORT || "9080");
server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on 0.0.0.0:${port}`);
});
