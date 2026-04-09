import http from "node:http";
import http2 from "node:http2";
import { trace } from "@opentelemetry/api";
import {
  service,
  TerminalError,
  type Context,
  createEndpointHandler,
} from "@restatedev/restate-sdk";
import { otelTracingHook, shutdownTracing } from "./otel-hooks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// State shared across attempts (simulates external systems failing)
// In production these would be real external calls that sometimes fail.
// ---------------------------------------------------------------------------

const runAttempts = new Map<string, number>();
const handlerAttempts = new Map<string, number>();

function nextRunAttempt(invocationId: string): number {
  const n = (runAttempts.get(invocationId) ?? 0) + 1;
  runAttempts.set(invocationId, n);
  return n;
}

function nextHandlerAttempt(invocationId: string): number {
  const n = (handlerAttempts.get(invocationId) ?? 0) + 1;
  handlerAttempts.set(invocationId, n);
  return n;
}

// ---------------------------------------------------------------------------
// Payment Service — called by OrderProcessor
// ---------------------------------------------------------------------------

const paymentService = service({
  name: "PaymentService",
  handlers: {
    charge: async (ctx: Context, orderId: string) => {
      trace.getActiveSpan()?.addEvent("payment.charge.started", { orderId });
      const txId = await ctx.run("process-payment", async () => {
        await wait(150); // simulate payment gateway latency
        return `txn_${orderId}_${Date.now()}`;
      });
      trace.getActiveSpan()?.addEvent("payment.charge.completed", {
        orderId,
        txId,
      });
      return { txId, status: "charged" };
    },
  },
});

export type PaymentService = typeof paymentService;

// ---------------------------------------------------------------------------
// Order Processor — demonstrates all hook lifecycle events
// ---------------------------------------------------------------------------

const orderProcessor = service({
  name: "OrderProcessor",
  options: {
    // Low inactivity timeout so ctx.sleep(5000) triggers suspension
    inactivityTimeout: 1000,
  },
  handlers: {
    process: async (ctx: Context, orderId: string) => {
      const invocationId = ctx.request().id;
      trace.getActiveSpan()?.addEvent("order.process.started", {
        invocationId,
        orderId,
      });

      // 1. ctx.run that fails twice then succeeds (demonstrates run retries)
      const validated = await ctx.run("validate-order", async () => {
        const attempt = nextRunAttempt(invocationId);
        trace.getActiveSpan()?.addEvent("order.validation.attempt", {
          attempt,
          invocationId,
          orderId,
        });
        await wait(80); // simulate validation API call
        if (attempt <= 2) {
          throw new Error(
            `Validation service unavailable (attempt ${attempt})`
          );
        }
        return { orderId, valid: true };
      });
      ctx.console.log("Order validated:", validated);
      trace.getActiveSpan()?.addEvent("order.validated", { orderId });

      // 2. Call another service (demonstrates cross-service tracing)
      const payment = await ctx.serviceClient(paymentService).charge(orderId);
      ctx.console.log("Payment charged:", payment);
      trace.getActiveSpan()?.addEvent("order.payment.charged", {
        orderId,
        paymentTxId: payment.txId,
      });

      // 3. Sleep — longer than the inactivity timeout, guarantees suspension
      trace.getActiveSpan()?.addEvent("order.sleep.before", { orderId });
      await ctx.sleep(5000);
      ctx.console.log("Post-sleep processing");
      trace.getActiveSpan()?.addEvent("order.sleep.after", { orderId });

      // 4. Transient handler error on first attempt (demonstrates handler retry)
      if (nextHandlerAttempt(invocationId) === 1) {
        trace.getActiveSpan()?.addEvent("order.transient-error.retrying", {
          invocationId,
          orderId,
        });
        throw new Error("Transient handler error — will retry");
      }

      // 5. Success
      trace.getActiveSpan()?.addEvent("order.process.completed", {
        invocationId,
        orderId,
        paymentTxId: payment.txId,
      });
      return {
        orderId,
        status: "processed",
        paymentTxId: payment.txId,
      };
    },
  },
});

// ---------------------------------------------------------------------------
// Start the endpoint
// ---------------------------------------------------------------------------

const PORT = 9080;
const mode = process.env.MODE === "req-res" ? "req-res" : "bidi";

const services = [orderProcessor, paymentService];
const hooks = [otelTracingHook];

const handler = createEndpointHandler({
  services,
  defaultServiceOptions: {
    hooks,
  },
  bidirectional: mode === "bidi",
});

if (mode === "req-res") {
  http.createServer(handler).listen(PORT);
} else {
  http2.createServer(handler).listen(PORT);
}

// Flush pending spans on shutdown
process.on("SIGTERM", () => shutdownTracing().then(() => process.exit(0)));
process.on("SIGINT", () => shutdownTracing().then(() => process.exit(0)));

const filter = "--filter @restatedev/otel";
const registerCmd =
  mode === "req-res"
    ? `pnpm ${filter} register:req-res`
    : `pnpm ${filter} register`;

console.log(`
  Service endpoint listening on :${PORT} (${mode})

  Quick start:
    1. pnpm ${filter} infra        # Start Jaeger + Restate
    2. ${registerCmd}   # Register this deployment
    3. pnpm ${filter} invoke       # Process an order
    4. http://localhost:16686                         # Open Jaeger UI

  To run in request-response mode:
    pnpm ${filter} dev:req-res
`);
