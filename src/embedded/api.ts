/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { RestateGrpcChannel, RpcGateway } from "../restate_context";
import { doInvoke } from "./invocation";
import { wrapHandler } from "./handler";
import crypto from "crypto";
import { RemoteContext } from "../generated/proto/services";
import { bufConnectRemoteContext } from "./http2_remote";
import { OutgoingHttpHeaders } from "http";
import { RetrySettings } from "../utils/public_utils";

export type RestateConnectionOptions = {
  /**
   * Additional headers attached to the requests sent to Restate.
   */
  headers: OutgoingHttpHeaders;
};

export type RestateInvocationOptions = {
  /**
   * Retention period for the response in seconds.
   * After the invocation completes, the response will be persisted for the given duration.
   * Afterward, the system will clean up the response and treats any subsequent invocation with same operation_id as new.
   *
   * If not set, 30 minutes will be used as retention period.
   */
  retain?: number;
};

/**
 * The context that gives access to all Restate-backed operations, for example
 *   - sending reliable messages / RPC through Restate
 *   - side effects
 *   - delayed calls
 *   - awakeables
 *   - ...
 *
 * This context is for use with the **embedded-handler API**.
 */
export interface EmbeddedHandlerContext {
  /**
   * The unique id that identifies the current function invocation. This id is guaranteed to be
   * unique across invocations, but constant across reties and suspensions.
   */
  id: Buffer;

  /**
   * Execute a side effect and store the result in Restate. The side effect will thus not
   * be re-executed during a later replay, but take the durable result from Restate.
   *
   * Side effects let you capture potentially non-deterministic computation and interaction
   * with external systems in a safe way.
   *
   * Failure semantics of side effects are:
   *   - If a side effect executed and persisted before, the result (value or Error) will be
   *     taken from the Restate journal.
   *   - There is a small window where a side effect may be re-executed twice, if a failure
   *     occurred between execution and persisting the result.
   *   - No second side effect will be executed while a previous side effect's result is not
   *     yet durable. That way, side effects that build on top of each other can assume
   *     deterministic results from previous effects, and at most one side effect will be
   *     re-executed on replay (the latest, if the failure happened in the small windows
   *     described above).
   *
   * This function takes an optional retry policy, that determines what happens if the
   * side effect throws an error. The default retry policy retries infinitely, with exponential
   * backoff and uses suspending sleep for the wait times between retries.
   *
   * @example
   * const ctx = restate.useContext(this);
   * const result = await ctx.sideEffect(async () => someExternalAction() )
   *
   * @example
   * const paymentAction = async () => {
   *   const result = await paymentClient.call(txId, methodIdentifier, amount);
   *   if (result.error) {
   *     throw result.error;
   *   } else {
   *     return result.payment_accepted;
   *   }
   * }
   * const paymentAccepted: boolean =
   *   await ctx.sideEffect(paymentAction, { maxRetries: 10});
   *
   * @param fn The function to run as a side effect.
   * @param retryPolicy The optional policy describing how retries happen.
   */
  sideEffect<T>(fn: () => Promise<T>, retryPolicy?: RetrySettings): Promise<T>;

  /**
   * Register an awakeable and pause the processing until the awakeable ID (and optional payload) have been returned to the service
   * (via ctx.completeAwakeable(...)). The SDK deserializes the payload with `JSON.parse(result.toString()) as T`.
   * @returns
   * - id: the string ID that has to be used to complete the awakaeble by some external service
   * - promise: the Promise that needs to be awaited and that is resolved with the payload that was supplied by the service which completed the awakeable
   *
   * @example
   * const ctx = restate.useContext(this);
   * const awakeable = ctx.awakeable<string>();
   *
   * // send the awakeable ID to some external service that will wake this one back up
   * // The ID can be retrieved by:
   * const id = awakeable.id;
   *
   * // ... send to external service ...
   *
   * // Wait for the external service to wake this service back up
   * const result = await awakeable.promise;
   */
  awakeable<T>(): { id: string; promise: Promise<T> };

  /**
   * Resolve an awakeable of another service.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param payload the payload to pass to the service that is woken up.
   * The SDK serializes the payload with `Buffer.from(JSON.stringify(payload))`
   * and deserializes it in the receiving service with `JSON.parse(result.toString()) as T`.
   *
   * @example
   * const ctx = restate.useContext(this);
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.resolveAwakeable(awakeableIdentifier, "hello");
   */
  resolveAwakeable<T>(id: string, payload: T): void;

  /**
   * Reject an awakeable of another service. When rejecting, the service waiting on this awakeable will be woken up with a terminal error with the provided reason.
   * @param id the string ID of the awakeable.
   * This is supplied by the service that needs to be woken up.
   * @param reason the reason of the rejection.
   *
   * @example
   * const ctx = restate.useContext(this);
   * // The sleeping service should have sent the awakeableIdentifier string to this service.
   * ctx.rejectAwakeable(awakeableIdentifier, "super bad error");
   */
  rejectAwakeable(id: string, reason: string): void;

  /**
   * Get the {@link RpcGateway} to invoke Handler-API based services.
   */
  rpcGateway(): RpcGateway;

  /**
   * Get the {@link RestateGrpcChannel} to invoke gRPC based services.
   */
  grpcChannel(): RestateGrpcChannel;
}

export const connection = (
  address: string,
  opt?: RestateConnectionOptions
): RestateConnection =>
  new RestateConnection(bufConnectRemoteContext(address, opt));

export class RestateConnection {
  constructor(private readonly remote: RemoteContext) {}

  public invoke<I, O>(
    id: string,
    input: I,
    handler: (ctx: EmbeddedHandlerContext, input: I) => Promise<O>,
    opt?: RestateInvocationOptions
  ): Promise<O> {
    const method = wrapHandler(handler);
    const streamId = crypto.randomUUID();
    return doInvoke<I, O>(this.remote, id, streamId, input, method, opt);
  }
}
