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

// Tier 14: scopes — routing calls into a named scope.
//
// Maps to guide.md §"Scopes".
//
//   scope(scopeKey).client(def)         — scoped typed call into a service
//   scope(scopeKey).client(def, key)    — scoped call into an object/workflow
//   scope(scopeKey).sendClient(def)     — scoped fire-and-forget
//   scope(scopeKey).sendClient(def, key)
//
// A scope is a sub-grouping of resources (invocations, virtual-object
// instances, concurrency limits) in the Restate cluster. It becomes part of
// the target identity — it contributes to the partition key, co-locating
// everything in a scope — and server-side rate-limit rules can match on it.
// So calls that share a scope can be throttled together.
//
// The concrete use case below: we wrap a third-party API (Amazon's merchant
// API) that has a per-API-key request quota. By scoping every outbound call
// by the caller's API key, we let Restate enforce a per-key rate limit and
// never blow the upstream quota — without writing any limiter ourselves.
//
// A scope key must match `[a-zA-Z0-9_.-]`, 1..36 chars. Per-call `limitKey`
// (via Opts/SendOpts) can only be used within a scope.
//
// NOTE: scopes are experimental and require restate-server >= 1.7 with flow
// control + protocol v7 enabled (RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true
// and RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true). Without them the invocation
// is rejected.

import { service, schemas, scope } from "@restatedev/restate-sdk-gen";
import { z } from "zod";

// ─── Amazon Merchant Service: a third-party API wrapper ───────────

const CheckoutRequest = z.object({
  orderId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
});
const CheckoutResponse = z.object({ confirmationId: z.string() });

export const amazonMerchantService = service({
  name: "AmazonMerchantService",
  handlers: {
    // In a real app this would call the Amazon Merchant API using the
    // user-provided API key carried by the scope.
    checkout: schemas(
      { input: CheckoutRequest, output: CheckoutResponse },
      function* (req) {
        return { confirmationId: `conf-${req.orderId}` };
      }
    ),
  },
});

// ─── Order Processor: scoped calls to rate-limit per API key ──────

const ProcessOrderRequest = z.object({
  orderId: z.string(),
  amazonApiKey: z.string(),
});

export const orderProcessor = service({
  name: "OrderProcessor",
  handlers: {
    /**
     * Process an order by calling AmazonMerchantService within a scope keyed
     * by the user's Amazon API key.
     *
     * The scope + configured rate-limit rules ensure that calls sharing the
     * same API key are rate-limited (e.g. 10 requests every 2 hours),
     * preventing us from exceeding the third-party API quota.
     *
     * Rate-limit rules are configured externally in Restate:
     *
     *   // Default rule: on any scope, rate limit AmazonMerchantService to 10 req / 2h
     *   {
     *     "scope": { "any": true },
     *     "match": { "service": "AmazonMerchantService" },
     *     "limit": { "rateLimit": { "count": 10, "interval": { "hours": 2 } } }
     *   }
     *
     *   // Override for a specific API key: increase the limit to 100 req / 2h
     *   {
     *     "scope": { "equals": "amz-api-key-123" },
     *     "match": { "service": "AmazonMerchantService" },
     *     "limit": { "rateLimit": { "count": 100, "interval": { "hours": 2 } } }
     *   }
     */
    processOrder: schemas(
      { input: ProcessOrderRequest, output: z.string() },
      function* (req) {
        // Scope the call by the user's Amazon API key. Restate enforces the
        // rate-limit rules configured for this scope + AmazonMerchantService.
        const response = yield* scope(req.amazonApiKey)
          .client(amazonMerchantService)
          .checkout({
            orderId: req.orderId,
            productId: "product-42",
            quantity: 1,
          });

        return `Order ${req.orderId} confirmed: ${response.confirmationId}`;
      }
    ),
  },
});
