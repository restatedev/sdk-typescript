import type {
  Service,
  VirtualObjectDefinitionFrom,
  Workflow,
  VirtualObject,
  ServiceDefinitionFrom,
  WorkflowDefinitionFrom,
} from "@restatedev/restate-sdk-core";

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
  resolveAwakeable<T>(id: string, payload?: T): Promise<void>;

  /**
   * Reject an awakeable from the ingress client.
   */
  rejectAwakeable(id: string, reason: string): Promise<void>;

  /**
   * Obtain the result of a service that was asynchronously submitted (via a sendClient).
   *
   * @param send either the send response or the workflow submission as obtained by the respective clients.
   */
  result<T>(send: Send<T> | WorkflowSubmission<T>): Promise<T>;
}

export interface IngresCallOptions {
  /**
   * Key to use for idempotency key.
   *
   * See https://docs.restate.dev/operate/invocation#invoke-a-handler-idempotently for more details.
   */
  idempotencyKey?: string;

  /**
   * Headers to attach to the request.
   */
  headers?: Record<string, string>;
}

export interface IngresSendOptions extends IngresCallOptions {
  /**
   * If set, the invocation will be executed after the provided delay. In milliseconds.
   */
  delay?: number;
}

export class Opts {
  /**
   * Create a call configuration from the provided options.
   *
   * @param opts the call configuration
   */
  public static from(opts: IngresCallOptions): Opts {
    return new Opts(opts);
  }

  constructor(readonly opts: IngresCallOptions) {}
}

export class SendOpts {
  /**
   * @param opts Create send options
   */
  public static from(opts: IngresSendOptions): SendOpts {
    return new SendOpts(opts);
  }

  delay(): number | undefined {
    return this.opts.delay;
  }

  constructor(readonly opts: IngresSendOptions) {}
}

export type IngressClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: [...P, ...[opts?: Opts]]) => PromiseLike<O>
    : never;
};

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
      ? (...args: P) => PromiseLike<O>
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
        ? (...args: I) => Promise<WorkflowSubmission<O>>
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
        ? () => Promise<O>
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
        ? () => Promise<Output<O>>
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
  ) => infer O
    ? (...args: [...P, ...[opts?: SendOpts]]) => Promise<Send<O>>
    : never;
};

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
};
