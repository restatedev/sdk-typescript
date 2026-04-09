/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  trace,
} from "@opentelemetry/api";
import { service, serve, type Context } from "@restatedev/restate-sdk";
import { openTelemetryHook } from "@restatedev/restate-sdk-opentelemetry";

// Setup NodeSDK, uses grpc otlp trace exporter (the same used by the Restate runtime by default).
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "restate-greeter-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4317",
  }),
});

// Start otel SDK, and register listener to flush spans on SIGTERM
sdk.start();
process.on("SIGTERM", () => {
  sdk.shutdown().then(() => process.exit(0));
});

const greeter = service({
  name: "GreeterWithTelemetry",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      // Add an event using trace.getActiveSpan().addEvent()
      trace.getActiveSpan()?.addEvent("my.event", { name });

      // ctx.runs get automatically their span, child of the attempt span.
      const greeting = await ctx.run("compute-greet", async () => {
        const greeting = `Hello, ${name}!`;
        // The active span can be also used for downstream propagation
        trace.getActiveSpan()?.addEvent("greet-value", { hello: greeting });
        return greeting;
      });

      return greeting;
    },
  },
  options: {
    // Set up the openTelemetryHook, this will take care of the tracing span creation and context propagation
    hooks: [openTelemetryHook({ tracer: trace.getTracer("greeter-service") })],
  },
});

serve({
  services: [greeter],
});
