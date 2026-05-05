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
import "./promise_combinators.js";
import "./explicit_cancellation.js";
import "./signals.js";
import "./preview_serdes.js";
import "./ingress_default_serde.js";
import "./hooks.js";
import "./memory_leak.js";
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

const port = parseInt(process.env.PORT || "9080");
const identityKeys = process.env.E2E_REQUEST_SIGNING
  ? process.env.E2E_REQUEST_SIGNING.split(",")
  : undefined;
const selectedServices = REGISTRY.definitions(
  !process.env.SERVICES || process.env.SERVICES === "*"
    ? undefined
    : new Set(process.env.SERVICES.split(","))
);

function startNodeHttp2Endpoint() {
  const settings: http2.Settings = {};
  if (process.env.MAX_CONCURRENT_STREAMS) {
    settings.maxConcurrentStreams = parseInt(
      process.env.MAX_CONCURRENT_STREAMS
    );
  }

  let inflightRequests = 0;
  let activeSessions = 0;
  const sessions = new Map<number, Set<string>>();

  const handler = restate.createEndpointHandler({
    services: selectedServices,
    identityKeys,
  });
  const server = http2.createServer((req, res) => {
    inflightRequests++;
    res.once("close", () => {
      inflightRequests--;
    });
    handler(req, res);
  });

  server.on("session", (session) => {
    const sessionId = activeSessions++;
    const streams = new Set<string>();
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
      `${new Date().toISOString()}: Inflight requests: ${inflightRequests}`
    );
    console.table(
      Array.from(sessions.values()).map((set: Set<string>) => ({
        "#streams": set.size,
      }))
    );
  }, 30 * 1000);

  server.updateSettings(settings);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on 0.0.0.0:${port}`);
  });
}

const endpointAdapter =
  process.env.RESTATE_E2E_ENDPOINT_ADAPTER ?? "node-http2";
if (endpointAdapter === "fetch") {
  const { startFetchEndpoint } = await import("./fetch_endpoint.js");
  startFetchEndpoint({ port, services: selectedServices, identityKeys });
} else if (endpointAdapter === "node-http2" || endpointAdapter === "http2") {
  startNodeHttp2Endpoint();
} else {
  throw new Error(
    `Unsupported RESTATE_E2E_ENDPOINT_ADAPTER=${endpointAdapter}`
  );
}
