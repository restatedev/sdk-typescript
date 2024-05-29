import type {
  Service,
  VirtualObjectDefinitionFrom,
  Workflow,
  VirtualObject,
  ServiceDefinitionFrom,
  WorkflowDefinitionFrom,
} from "@restatedev/restate-sdk-core";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Ingress {
  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceClient<D>(opts: ServiceDefinitionFrom<D>): IngressClient<Service<D>>;

  /**
   * Create a client from a {@link WorkflowDefinition}.
   */
  workflowClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): IngressWorkflowClient<Workflow<D>>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
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
  public static from(opts: IngresCallOptions): Opts {
    return new Opts(opts);
  }

  constructor(readonly opts: IngresCallOptions) {}
}

export class SendOpts {
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

export interface Output<O> {
  ready: boolean;
  result: O;
}

export type WorkflowSubmission = {
  invocationId: string;
  status: "Accepted" | "PreviouslyAccepted";
};

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
     * This instructs restate to execute the 'run' handler.
     *
     * @param argument the same argument type as defined by the 'run' handler.
     */
    workflowSubmit: M extends Record<string, unknown>
      ? M["run"] extends (arg: any, ...args: infer I) => Promise<unknown>
        ? (...args: I) => Promise<WorkflowSubmission>
        : never
      : never;

    workflowAttach: M extends Record<string, unknown>
      ? M["run"] extends (...args: any) => Promise<infer O>
        ? () => Promise<O>
        : never
      : never;

    workflowOutput: M extends Record<string, unknown>
      ? M["run"] extends (...args: any) => Promise<infer O>
        ? () => Promise<Output<O>>
        : never
      : never;
  },
  "run"
>;

export type SendResponse = {
  invocationId: string;
  status: "Accepted" | "PreviouslyAccepted";
};

export type IngressSendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    arg: any,
    ...args: infer P
  ) => unknown
    ? (...args: [...P, ...[opts?: SendOpts]]) => Promise<SendResponse>
    : never;
};

export type ConnectionOpts = {
  /**
   * Restate URL.
   */
  url: string;
  /**
   * Headers to attach on every request.
   */
  headers?: Record<string, string>;
};
