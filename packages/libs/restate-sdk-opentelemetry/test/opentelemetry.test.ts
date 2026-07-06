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

import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import * as clients from "@restatedev/restate-sdk-clients";
import { service, TerminalError, type Context } from "@restatedev/restate-sdk";
import { context, trace, type Attributes } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { openTelemetryHook } from "../src/index.js";

// The Restate SDK is OpenTelemetry-agnostic, so nothing registers a context
// manager for us (in production `NodeSDK.start()` does it). The hook relies on
// `context.with()` / `trace.getActiveSpan()`, which are silent no-ops without
// one - so the replay case's `addEvent` would vanish. Register it once for the
// whole file.
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
});

afterAll(() => {
  context.disable();
});

// --- span normalization -----------------------------------------------------

interface NormalizedSpan {
  name: string;
  kind: string;
  status: string;
  parent: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
}

const SPAN_KIND = ["INTERNAL", "SERVER", "CLIENT", "PRODUCER", "CONSUMER"];
const STATUS = ["UNSET", "OK", "ERROR"];

function hrToNanos(t: readonly [number, number]): number {
  return t[0] * 1e9 + t[1];
}

// Project attributes to a stable, sorted form: redact the per-run invocation id
// and drop the exception stacktrace (absolute file paths + line numbers).
function normalizeAttributes(attrs: Attributes): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(attrs).sort()) {
    if (key === "exception.stacktrace") {
      continue;
    }
    out[key] = key === "restate.invocation.id" ? "<redacted>" : attrs[key];
  }
  return out;
}

// Reduce finished spans to a deterministic tree: ids/timestamps stripped, the
// parent expressed relationally (the name of a local span, or "<incoming>" for
// the runtime's span that lives outside our exporter).
function normalize(spans: readonly ReadableSpan[]): NormalizedSpan[] {
  const nameBySpanId = new Map<string, string>();
  for (const span of spans) {
    nameBySpanId.set(span.spanContext().spanId, span.name);
  }

  return [...spans]
    .sort((a, b) => hrToNanos(a.startTime) - hrToNanos(b.startTime))
    .map((span) => {
      const parentId =
        span.parentSpanContext?.spanId ??
        (span as { parentSpanId?: string }).parentSpanId;
      const parent = parentId
        ? (nameBySpanId.get(parentId) ?? "<incoming>")
        : "<root>";

      const events = span.events.map((event) => {
        const attributes = normalizeAttributes(event.attributes ?? {});
        return Object.keys(attributes).length > 0
          ? { name: event.name, attributes }
          : { name: event.name };
      });

      return {
        name: span.name,
        kind: SPAN_KIND[span.kind] ?? String(span.kind),
        status: STATUS[span.status.code] ?? String(span.status.code),
        parent,
        attributes: normalizeAttributes(span.attributes),
        events,
      };
    });
}

async function collectSpans(
  exporter: InMemorySpanExporter,
  provider: BasicTracerProvider,
  predicate: (spans: readonly ReadableSpan[]) => boolean,
  timeoutMs = 5000
): Promise<NormalizedSpan[]> {
  const start = Date.now();
  for (;;) {
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    if (predicate(spans) || Date.now() - start > timeoutMs) {
      return normalize(spans);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function newTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return { exporter, provider, tracer: provider.getTracer("otel-hook-test") };
}

// --- happy + error paths (normal runtime) -----------------------------------

describe("openTelemetryHook spans", { timeout: 60_000 }, () => {
  const { exporter, provider, tracer } = newTracing();

  const greeter = service({
    name: "Greeter",
    handlers: {
      greet: async (ctx: Context, name: string) => {
        return ctx.run("compute", async () => `Hello, ${name}!`);
      },
    },
    options: { hooks: [openTelemetryHook({ tracer })] },
  });

  const boom = service({
    name: "Boom",
    handlers: {
      fail: async (_ctx: Context): Promise<never> => {
        throw new TerminalError("handler blew up");
      },
    },
    options: { hooks: [openTelemetryHook({ tracer })] },
  });

  let env: RestateTestEnvironment;
  let rs: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({ services: [greeter, boom] });
    rs = clients.connect({ url: env.baseUrl() });
  }, 60_000);

  afterAll(async () => {
    await env?.stop();
  });

  afterEach(() => {
    exporter.reset();
  });

  it("emits an attempt span with a child run span on success", async () => {
    const result = await rs.serviceClient(greeter).greet("world");
    expect(result).toBe("Hello, world!");

    const spans = await collectSpans(exporter, provider, (s) => s.length >= 2);
    expect(spans).toMatchInlineSnapshot(`
      [
        {
          "attributes": {
            "restate.invocation.id": "<redacted>",
            "restate.invocation.target": "Greeter/greet",
          },
          "events": [],
          "kind": "INTERNAL",
          "name": "attempt Greeter/greet",
          "parent": "<root>",
          "status": "OK",
        },
        {
          "attributes": {
            "restate.run.name": "compute",
          },
          "events": [],
          "kind": "INTERNAL",
          "name": "run (compute)",
          "parent": "attempt Greeter/greet",
          "status": "OK",
        },
      ]
    `);
  });

  it("marks the attempt span as errored and records the exception", async () => {
    await expect(rs.serviceClient(boom).fail()).rejects.toThrow(
      "handler blew up"
    );

    const spans = await collectSpans(exporter, provider, (s) =>
      s.some((span) => span.status.code === 2)
    );
    expect(spans).toMatchInlineSnapshot(`
      [
        {
          "attributes": {
            "restate.invocation.id": "<redacted>",
            "restate.invocation.target": "Boom/fail",
          },
          "events": [
            {
              "attributes": {
                "exception.message": "handler blew up",
                "exception.type": "500",
              },
              "name": "exception",
            },
          ],
          "kind": "INTERNAL",
          "name": "attempt Boom/fail",
          "parent": "<root>",
          "status": "ERROR",
        },
      ]
    `);
  });
});

// --- replay event suppression (alwaysReplay runtime) ------------------------

describe("openTelemetryHook replay suppression", { timeout: 60_000 }, () => {
  const { exporter, provider, tracer } = newTracing();

  // Adds an event before and after a suspension point. With alwaysReplay the
  // invocation suspends at the sleep and replays: on the replayed attempt the
  // pre-suspension event is re-added while replaying journaled work and must be
  // suppressed, while the post-suspension event (fresh processing) is kept.
  const replayer = service({
    name: "Replayer",
    handlers: {
      go: async (ctx: Context) => {
        trace.getActiveSpan()?.addEvent("before-suspend");
        await ctx.sleep(10);
        trace.getActiveSpan()?.addEvent("after-suspend");
        return "done";
      },
    },
    options: { hooks: [openTelemetryHook({ tracer })] },
  });

  let env: RestateTestEnvironment;
  let rs: clients.Ingress;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start({
      services: [replayer],
      alwaysReplay: true,
    });
    rs = clients.connect({ url: env.baseUrl() });
  }, 60_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("suppresses span events added while replaying journaled work", async () => {
    const result = await rs.serviceClient(replayer).go();
    expect(result).toBe("done");

    // Two attempts: the original (suspends at sleep) and the replay.
    const spans = await collectSpans(exporter, provider, (s) => s.length >= 2);
    expect(spans).toMatchInlineSnapshot(`
      [
        {
          "attributes": {
            "restate.invocation.id": "<redacted>",
            "restate.invocation.target": "Replayer/go",
          },
          "events": [
            {
              "name": "before-suspend",
            },
          ],
          "kind": "INTERNAL",
          "name": "attempt Replayer/go",
          "parent": "<root>",
          "status": "UNSET",
        },
        {
          "attributes": {
            "restate.invocation.id": "<redacted>",
            "restate.invocation.target": "Replayer/go",
          },
          "events": [
            {
              "name": "after-suspend",
            },
          ],
          "kind": "INTERNAL",
          "name": "attempt Replayer/go",
          "parent": "<root>",
          "status": "OK",
        },
      ]
    `);
  });
});
