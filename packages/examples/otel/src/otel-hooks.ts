import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { openTelemetryHook } from "@restatedev/restate-sdk-opentelemetry";

// Cache TracerProviders per service name so we don't create duplicates.
const providers = new Map<string, NodeTracerProvider>();

function getTracerForService(serviceName: string): Tracer {
  let provider = providers.get(serviceName);
  if (!provider) {
    provider = new NodeTracerProvider({
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

export const otelTracingHook = openTelemetryHook({
  tracer: ({ request }) => getTracerForService(request.target.service),
  runSpans: true,
});
