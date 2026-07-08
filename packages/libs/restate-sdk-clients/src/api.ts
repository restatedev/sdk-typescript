import type {
  Service,
  VirtualObjectDefinitionFrom,
  Workflow,
  VirtualObject,
  ServiceDefinitionFrom,
  WorkflowDefinitionFrom,
  Serde,
  Duration,
  JournalValueCodec,
} from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis } from "@restatedev/restate-sdk-core";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A remote client for a Restate service.
 *
 * Use the following client to interact with services defined
 * - `serviceClient` to create a client for a service.
 * - `workflowClient` to create a client for a workflow.
 * - `objectClient` to create a client for a virtual object.
 *
 */
export interface Ingress {
  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceClient<D>(opts: ServiceDefinitionFrom<D>): IngressClient<Service<D>>;

  /**
   * Create a client from a {@link WorkflowDefinition}.
   *
   * @param key the key of the workflow.
   */
  workflowClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): IngressWorkflowClient<Workflow<D>>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   * @param key the key of the virtual object.
   */
  objectClient<D>(
    opts: VirtualObjectDefinitionFrom<D>,
    key: string
  ): IngressClient<VirtualObject<D>>;

  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceSendClient<D>(
    opts: ServiceDefinitionFrom<D>
  ): IngressSendClient<Service<D>>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   */
  objectSendClient<D>(
    opts: VirtualObjectDefinitionFrom<D>,
    key: string
  ): IngressSendClient<VirtualObject<D>>;

  /**
   * Resolve an awakeable from the ingress client.
   */
  resolveAwakeable<T>(
    id: string,
    payload?: T,
    payloadSerde?: Serde<T>
  ): Promise<void>;

  /**
   * Reject an awakeable from the ingress client.
   */
  rejectAwakeable(id: string, reason: string): Promise<void>;

  /**
   * Obtain the result of a service that was asynchronously submitted (via a sendClient).
   *
   * @param send either the send response or the workflow submission as obtained by the respective clients.
   */
  result<T>(
    send: Send<T> | WorkflowSubmission<T>,
    resultSerde?: Serde<T>
  ): Promise<T>;

  /** Generic request-response call. Routes directly by service name without a typed definition. */
  call<I = Uint8Array, O = Uint8Array>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    /**
     * Route this call within the given scope. See {@link Ingress.scope}.
     *
     * *NOTE:* This API is experimental. To use it you need a restate-server >= 1.7,
     * configured to enable
     * [service protocol v7](https://github.com/restatedev/restate/blob/main/release-notes/v1.7.0.md#service-protocol-v7)
     * and [flow control](https://github.com/restatedev/restate/blob/main/release-notes/v1.7.0.md#flow-control).
     * For example, start the restate-server with the environment variables
     * `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true` and `RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true`.
     *
     * @experimental
     */
    scope?: string;
    opts?: Opts<I, O>;
  }): Promise<O>;

  /** Generic fire-and-forget send. Routes directly by service name without a typed definition. */
  send<I = Uint8Array>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    /**
     * Route this send within the given scope. See {@link Ingress.scope}.
     *
     * *NOTE:* This API is experimental. To use it you need a restate-server >= 1.7,
     * configured to enable
     * [service protocol v7](https://github.com/restatedev/restate/blob/main/release-notes/v1.7.0.md#service-protocol-v7)
     * and [flow control](https://github.com/restatedev/restate/blob/main/release-notes/v1.7.0.md#flow-control).
     * For example, start the restate-server with the environment variables
     * `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true` and `RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true`.
     *
     * @experimental
     */
    scope?: string;
    opts?: SendOpts<I>;
  }): Promise<Send>;

  /**
   * Returns a {@link ScopedIngress} that routes all calls within the given scope.
   *
   * **NOTE:** This API is in preview and is not enabled by default.
   * To use it in restate-server 1.7, enable the flow control and protocol v7 experimental features,
   * via `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true` and `RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true`.
   * These can be enabled only on **new clusters**, for more info check out https://docs.restate.dev/services/flow-control#enabling-flow-control.
   * If these experimental features aren't enabled, the invocation won't be ingested and the client request fails.
   *
   * A scope is a sub-grouping of resources (invocations, virtual object instances, workflow
   * instances, concurrency limits) within the Restate cluster.
   * It becomes part of the target identity tuple:
   * - `scope, service, handler, idempotencyKey?`
   * - `scope, virtualObject, objectKey, handler, idempotencyKey?`
   * - `scope, workflow, workflowKey, handler`
   *
   * Under the hood, the scope contributes to the partition key, so all resources in a scope get co-located by the restate-server.
   *
   * Omitting the scope (i.e. using the regular `serviceClient` / `workflowClient` methods)
   * is equivalent to calling with no scope, which is the existing behavior.
   *
   * The scope key must consist only of `[a-zA-Z0-9_.-]` characters, with 1 <= length <= 36 chars.
   *
   * @example
   * ```ts
   * // Route a call into a named scope
   * await ingress.scope("tenant-123").serviceClient(MyService).process(payload);
   *
   * // Idempotency keys are scoped — "req-1" in "tenant-123" is distinct from "req-1" in "tenant-456"
   * await ingress.scope("tenant-123").serviceClient(MyService)
   *   .process(payload, rpc.opts({ idempotencyKey: "req-1" }));
   *
   * // Combine with a limit key to enforce per-scope concurrency limits
   * await ingress.scope("tenant-123").workflowClient(MyWorkflow, "wf-key")
   *   .run(input, rpc.opts({ limitKey: "api-key/user42" }));
   * ```
   *
   * @param scopeKey the scope identifier
   * @see https://docs.restate.dev/services/flow-control
   * @experimental
   */
  scope(scopeKey: string): ScopedIngress;
}

/**
 * An ingress client for making RPC calls within a specific scope.
 *
 * @see {@link Ingress.scope}
 * @experimental
 * @interface
 */
export type ScopedIngress = Pick<
  Ingress,
  | "serviceClient"
  | "serviceSendClient"
  | "objectClient"
  | "objectSendClient"
  | "workflowClient"
>;

export interface IngressCallOptions<I = unknown, O = unknown> {
  /**
   * Key to use for idempotency key.
   *
   * See https://docs.restate.dev/operate/invocation#invoke-a-handler-idempotently for more details.
   */
  idempotencyKey?: string;

  /**
   * An optional concurrency limit key within the scope.
   * A limit key can only be used in conjunction with a scope (see {@link Ingress.scope}).
   *
   * **NOTE:** This API is in preview and is not enabled by default.
   * To use it in restate-server 1.7, enable the flow control and protocol v7 experimental features,
   * via `RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7=true` and `RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true`.
   * These can be enabled only on **new clusters**, for more info check out https://docs.restate.dev/services/flow-control#enabling-flow-control.
   * If these experimental features aren't enabled, the invocation isn't ingested and the client request fails.
   *
   * The limit key enforces hierarchical concurrency limits on invocations sharing the same scope.
   * It can have one or two levels separated by `/` (e.g. `"tenant1"` or `"tenant1/user42"`).
   * Each level must consist only of `[a-zA-Z0-9_.-]` characters, and 1 <= length <= 36.
   *
   * The limit key is **not** part of the request identity: two calls to the same target with the
   * same scope and object key but different limit keys refer to the **same** resource instance.
   * The limit key only affects concurrency limits, not resource identity.
   *
   * @experimental
   */
  limitKey?: string;

  /**
   * Headers to attach to the request.
   */
  headers?: Record<string, string>;

  input?: Serde<I>;

  output?: Serde<O>;

  /**
   * Timeout to be used when executing the request. In milliseconds.
   *
   * Same as {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal#aborting_a_fetch_with_timeout_or_explicit_abort | AbortSignal.timeout()}.
   *
   * This field is exclusive with `signal`, and using both of them will result in a runtime failure.
   */
  timeout?: number;

  /**
   * Signal to abort the underlying `fetch` operation. See {@link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal}.
   *
   * This field is exclusive with `timeout`, and using both of them will result in a runtime failure.
   */
  signal?: AbortSignal;
}

export interface IngressSendOptions<I> extends IngressCallOptions<I, void> {
  /**
   * If set, the invocation will be enqueued now to be executed after the provided delay. In milliseconds.
   */
  delay?: number | Duration;
}

export class Opts<I, O> {
  /**
   * Create a call configuration from the provided options.
   *
   * @param opts the call configuration
   */
  public static from<I = unknown, O = unknown>(
    opts: IngressCallOptions<I, O>
  ): Opts<I, O> {
    return new Opts(opts);
  }

  constructor(readonly opts: IngressCallOptions<I, O>) {}
}

export class SendOpts<I = unknown> {
  /**
   * @param opts Create send options
   */
  public static from<I = unknown>(opts: IngressSendOptions<I>): SendOpts<I> {
    return new SendOpts(opts);
  }

  delay(): number | undefined {
    if (this.opts.delay !== undefined) {
      return millisOrDurationToMillis(this.opts.delay);
    }
    return undefined;
  }

  constructor(readonly opts: IngressSendOptions<I>) {}
}

export type InferArgType<P> = P extends [infer A, ...any[]] ? A : unknown;

export type IngressClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: [...P, ...[opts?: Opts<InferArgType<P>, O>]]) => PromiseLike<O>
    : never;
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace rpc {
  export const opts = <I, O>(opts: IngressCallOptions<I, O>) => Opts.from(opts);

  export const sendOpts = <I>(opts: IngressSendOptions<I>) =>
    SendOpts.from(opts);
}

/**
 * Represents the output of a workflow.
 */
export interface Output<O> {
  /**
   * Whether the output is ready.
   */
  ready: boolean;

  /**
   * The output of the workflow.
   */
  result: O;
}

/**
 * Represents a successful workflow submission.
 *
 */
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export type WorkflowSubmission<T> = {
  /**
   * The invocation id of the workflow. You can use that id to
   * with the introspection tools (restate cli, logging, metrics)
   *
   */
  readonly invocationId: string;
  readonly status: "Accepted" | "PreviouslyAccepted";
  readonly attachable: true;
};

/**
 * A client for a workflow.
 *
 * This client represents the workflow definition, with the following additional methods:
 * - `workflowSubmit` to submit the workflow.
 * - `workflowAttach` to attach to the workflow and wait for its completion
 * - `workflowOutput` to check if the workflow's output is ready/available.
 *
 * Once a workflow is submitted, it can be attached to, and the output can be retrieved.
 *
 * @typeParam M the type of the workflow.
 */
export type IngressWorkflowClient<M> = Omit<
  {
    [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
      arg: any,
      ...args: infer P
    ) => PromiseLike<infer O>
      ? (
          ...args: [...P, ...[opts?: Opts<InferArgType<P>, O>]]
        ) => PromiseLike<O>
      : never;
  } & {
    /**
     * Submit this workflow.
     *
     * This instructs restate to execute the 'run' handler of the workflow, idempotently.
     * The workflow will be executed asynchronously, and the promise will resolve when the workflow has been accepted.
     * Please note that submitting a workflow does not wait for it to completion, and it is safe to retry the submission,
     * in case of failure.
     *
     * @param argument the same argument type as defined by the 'run' handler.
     */
    workflowSubmit: M extends Record<string, unknown>
      ? M["run"] extends (arg: any, ...args: infer I) => Promise<infer O>
        ? (
            ...args: [...I, ...[opts?: SendOpts<InferArgType<I>>]]
          ) => Promise<WorkflowSubmission<O>>
        : never
      : never;

    /**
     * Attach to this workflow.
     *
     * This instructs restate to attach to the workflow and wait for it to complete.
     * It is only possible to 'attach' to a workflow that has been previously submitted.
     * The promise will resolve when the workflow has completed either successfully with a result,
     * or be rejected with an error.
     * This operation is safe to retry many times, and it will always return the same result.
     *
     * @returns a promise that resolves when the workflow has completed.
     */
    workflowAttach: M extends Record<string, unknown>
      ? M["run"] extends (...args: any) => Promise<infer O>
        ? (opts?: Opts<void, O>) => Promise<O>
        : never
      : never;

    /**
     * Try retrieving the output of this workflow.
     *
     * This instructs restate to check if the workflow's output is ready/available.
     * The returned Output object will have a 'ready' field set to true if the output is ready.
     * If the output is ready, the 'result' field will contain the output.
     * note: that this operation will not wait for the workflow to complete, to do so use 'workflowAttach'.
     *
     * @returns a promise that resolves if the workflow's output is ready/available.
     */
    workflowOutput: M extends Record<string, unknown>
      ? M["run"] extends (...args: any) => Promise<infer O>
        ? (opts?: Opts<void, O>) => Promise<Output<O>>
        : never
      : never;
  },
  "run"
>;

/**
 * A send response.
 *
 * @typeParam T the type of the response.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Send<T = unknown> = {
  /**
   * The invocation id of the send.
   */
  invocationId: string;

  /**
   * The status of the send.
   */
  status: "Accepted" | "PreviouslyAccepted";

  attachable: boolean;
};

export type IngressSendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (
        ...args: [...P, ...[opts?: SendOpts<InferArgType<P>>]]
      ) => Promise<Send<O>>
    : never;
};

/**
 * An ambiguous ingress failure that may be retried.
 *
 * Passed to {@link RetryPolicy.shouldRetry} so a caller can inspect the failure
 * and decide whether to retry.
 */
export type RetryFailure =
  | {
      /** The underlying `fetch` call rejected (connection refused/reset, DNS). */
      readonly kind: "network";
      readonly error: unknown;
    }
  | {
      /** The server returned a non-2xx response. */
      readonly kind: "response";
      readonly status: number;
      readonly headers: Headers;
      /**
       * The response body, decoded as text, when the response carried a
       * non-empty body; `undefined` otherwise.
       */
      readonly body?: string;
    };

/**
 * Policy controlling automatic retries of ambiguous ingress failures.
 *
 * Retries are **opt-in**: they happen only when a policy is configured (see
 * {@link ConnectionOpts.retry}) **and** the call carries an `idempotencyKey`
 * (see {@link IngressCallOptions.idempotencyKey}). Retrying without a key could
 * double-execute a non-idempotent invocation, so the idempotency key is the
 * safety boundary that a policy can never bypass.
 *
 * By default the following failures are retried: network errors (the underlying
 * `fetch` rejecting), HTTP `429`, and HTTP `5xx` responses. Override this with
 * {@link RetryPolicy.shouldRetry}.
 */
export interface RetryPolicy {
  /**
   * Max number of attempts (including the initial), before giving up.
   *
   * Defaults to `6` (the initial attempt plus up to 5 retries).
   */
  maxAttempts?: number;

  /**
   * Initial backoff interval. If a number is provided, it is interpreted as
   * milliseconds. Defaults to `100` milliseconds.
   */
  initialInterval?: Duration | number;

  /**
   * Maximum backoff interval. If a number is provided, it is interpreted as
   * milliseconds. Defaults to `2000` milliseconds.
   */
  maxInterval?: Duration | number;

  /**
   * Exponentiation factor to use when computing the next retry delay.
   * Defaults to `2`.
   */
  exponentiationFactor?: number;

  /**
   * Decide whether a given failure should be retried. When provided, this
   * fully replaces the built-in rule (network / `429` / `5xx`).
   *
   * The idempotency-key gate and the `maxAttempts` cap still apply — this
   * predicate only narrows or broadens *which failures* are retryable within
   * those bounds. Compose with the built-in rule via the exported
   * `defaultShouldRetry`.
   *
   * @param failure the failure being considered
   * @param attempt the zero-based index of the attempt that just failed
   */
  shouldRetry?: (failure: RetryFailure, attempt: number) => boolean;
}

export type ConnectionOpts = {
  /**
   * Restate ingress URL.
   * For example: http://localhost:8080
   */
  url: string;
  /**
   * Headers to attach on every request.
   * Use this to attach authentication headers.
   */
  headers?: Record<string, string>;

  /**
   * Opt in to automatic retries of ambiguous ingress failures (network errors,
   * HTTP `429`, HTTP `5xx`).
   *
   * Retries are **disabled by default**. Set `true` to enable the built-in
   * policy ({@link RetryPolicy}), or pass a {@link RetryPolicy} to tune it.
   *
   * Even when enabled, retries fire **only** when an `idempotencyKey` is set on
   * the call — without one a retry could double-execute a non-idempotent
   * invocation. With a key, Restate dedupes the request, so a retry safely
   * attaches to the in-flight or completed invocation instead of starting a new
   * one.
   */
  retry?: RetryPolicy | boolean;

  /**
   * Default serde to use for ingress payloads when no operation-specific serde
   * is provided. Applies to handler calls, workflow attaches/output polling,
   * awakeable resolution, and attached invocation results.
   *
   * Defaults to `restate.serde.json`.
   */
  serde?: Serde<any>;

  /**
   * Codec to use for input/outputs. Check {@link JournalValueCodec} for more details
   *
   * @experimental
   */
  journalValueCodec?: JournalValueCodec;
};
