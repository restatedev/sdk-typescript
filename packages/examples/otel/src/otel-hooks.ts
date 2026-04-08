import {
  trace,
  context,
  propagation,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { internal } from "@restatedev/restate-sdk";
import type { HooksProvider } from "@restatedev/restate-sdk";

// Cache TracerProviders per service name so we don't create duplicates.
const providers = new Map<string, BasicTracerProvider>();

function getTracerForService(serviceName: string): Tracer {
  let provider = providers.get(serviceName);
  if (!provider) {
    provider = new BasicTracerProvider({
      resource: new Resource({ [ATTR_SERVICE_NAME]: `client-${serviceName}` }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: "http://localhost:4318/v1/traces",
          })
        ),
      ],
    });
    provider.register();
    providers.set(serviceName, provider);
  }
  return provider.getTracer(serviceName);
}

/**
 * Gracefully shut down all TracerProviders, flushing pending spans.
 * Call this on process exit to avoid losing in-flight traces.
 */
export async function shutdownTracing(): Promise<void> {
  await Promise.all([...providers.values()].map((p) => p.shutdown()));
}

/**
 * Creates a HooksProvider that integrates with OpenTelemetry tracing.
 *
 * Each Restate service gets its own TracerProvider with a distinct
 * `service.name`, so they appear as separate services in Jaeger.
 *
 * Follows the standardized span attributes from restate#4530:
 * - Per-attempt span: `restate.invocation.id`, `restate.invocation.target`
 * - Per-run span: `restate.run.name`
 *
 * Extracts the parent trace context from the Restate runtime's attempt
 * headers so SDK spans appear as children of the runtime's invocation spans
 * in the trace viewer (e.g. Jaeger).
 */
export const otelTracingHook: HooksProvider = (ctx) => {
  const { service: svc, handler: hdl, key } = ctx.request.target;
  const tracer = getTracerForService(svc);

  // Extract the parent trace context set by the Restate runtime.
  // attemptHeaders contains W3C traceparent/tracestate headers.
  const parentContext = propagation.extract(
    context.active(),
    ctx.request.attemptHeaders,
    {
      get(
        carrier: ReadonlyMap<string, string | string[] | undefined>,
        key: string
      ) {
        const value = carrier.get(key);
        if (Array.isArray(value)) return value[0];
        return value ?? undefined;
      },
      keys(carrier: ReadonlyMap<string, string | string[] | undefined>) {
        return [...carrier.keys()];
      },
    }
  );

  // Build the invocation target string (e.g. "OrderProcessor/process"
  // or "OrderProcessor/myKey/process" for keyed services).
  const target = key ? `${svc}/${key}/${hdl}` : `${svc}/${hdl}`;

  // Create the per-attempt span as a child of the runtime's trace.
  const attemptSpan = tracer.startSpan(
    `attempt: ${target}`,
    {
      attributes: {
        "restate.invocation.id": ctx.request.id,
        "restate.invocation.target": target,
      },
    },
    parentContext
  );

  // Context with the attempt span set as active.
  const attemptContext = trace.setSpan(parentContext, attemptSpan);

  return {
    interceptor: {
      // Establish the OTel context so that trace.getActiveSpan()
      // works inside handler code and child spans are linked.
      // Manage the attempt span lifecycle via try/catch/finally.
      handler: async (next) => {
        try {
          await context.with(attemptContext, next);
          attemptSpan.setStatus({ code: SpanStatusCode.OK });
        } catch (e) {
          if (!internal.isSuspendedError(e)) {
            attemptSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: e instanceof Error ? e.message : String(e),
            });
            if (e instanceof Error) attemptSpan.recordException(e);
          }
          throw e;
        } finally {
          attemptSpan.end();
        }
      },

      // Create a child span for each ctx.run() operation.
      run: (name, next) => {
        const runSpan = tracer.startSpan(
          `run (${name})`,
          { attributes: { "restate.run.name": name } },
          attemptContext
        );
        const runContext = trace.setSpan(attemptContext, runSpan);

        return context.with(runContext, async () => {
          try {
            await next();
            runSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (e) {
            runSpan.setStatus({ code: SpanStatusCode.ERROR });
            if (e instanceof Error) runSpan.recordException(e);
            throw e;
          } finally {
            runSpan.end();
          }
        });
      },
    },
  };
};
