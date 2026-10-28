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

import { create } from "@bufbuild/protobuf";
import type { Invocation, InvocationDefaults } from "./api.js";
import {
  type IngestionDefaults,
  IngestionDefaultsSchema,
  type IngestionInvocation,
  IngestionInvocationSchema,
} from "./generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";

const encoder = new TextEncoder();

// `create` ignores fields initialized to `undefined`, so unset optional fields stay unset on
// the wire and Restate falls back to the stream defaults for them.

export function toProtoDefaults(
  defaults: InvocationDefaults
): IngestionDefaults {
  return create(IngestionDefaultsSchema, {
    service: defaults.service,
    handler: defaults.handler,
    key: defaults.key,
    scope: defaults.scope,
    limitKey: defaults.limitKey,
    headers: defaults.headers,
  });
}

export function toProtoInvocation(
  invocation: Invocation,
  offset: number
): IngestionInvocation {
  return create(IngestionInvocationSchema, {
    offset: BigInt(offset),
    service: invocation.service,
    handler: invocation.handler,
    key: invocation.key,
    scope: invocation.scope,
    limitKey: invocation.limitKey,
    idempotencyKey: invocation.idempotencyKey,
    additionalHeaders: invocation.headers,
    invokeTimeTsMs:
      invocation.invokeAt !== undefined
        ? BigInt(invocation.invokeAt.getTime())
        : undefined,
    traceparent: invocation.traceparent,
    tracestate: invocation.tracestate,
    payload:
      typeof invocation.body === "string"
        ? encoder.encode(invocation.body)
        : invocation.body,
  });
}
