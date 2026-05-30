import { service, serve, type Context } from "@restatedev/restate-sdk";

interface CheckoutRequest {
  orderId: string;
  customerId: string;
  paymentMethodId: string;
}

interface PaymentResult {
  paymentId: string;
}

const checkout = service({
  name: "checkout",
  handlers: {
    submit: async (ctx: Context, input: CheckoutRequest) => {
      let contextLogger = ctx.console.child({
        orderId: input.orderId,
        customerId: input.customerId,
      });

      contextLogger.info("checkout started");

      const payment = await ctx.run("charge payment", async () => {
        return await chargePayment(input);
      });

      // This is rebuilt on replay from the journaled ctx.run result.
      contextLogger = contextLogger.child({ paymentId: payment.paymentId });
      contextLogger.info("payment charged");

      const shipment = await ctx.run("create shipment", async () => {
        return await createShipment(input.orderId);
      });

      contextLogger
        .child({ shipmentId: shipment.shipmentId })
        .info("shipment created");

      return {
        orderId: input.orderId,
        paymentId: payment.paymentId,
        shipmentId: shipment.shipmentId,
      };
    },
  },
});

export type Checkout = typeof checkout;

/**
 * Simulates charging a payment provider and returns a durable payment id.
 */
async function chargePayment(input: CheckoutRequest): Promise<PaymentResult> {
  return {
    paymentId: `payment-${input.paymentMethodId}`,
  };
}

/**
 * Simulates creating a shipment and returns a durable shipment id.
 */
async function createShipment(
  orderId: string
): Promise<{ shipmentId: string }> {
  return {
    shipmentId: `shipment-${orderId}`,
  };
}

serve({ services: [checkout] });
