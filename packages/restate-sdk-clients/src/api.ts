import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

export interface Ingress {
  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceClient<M, P extends string = string>(
    opts: ServiceDefinition<P, M>
  ): IngressClient<M>;

  /**
   * Create a client from a {@link WorkflowDefinition}.
   */
  workflowClient<M, P extends string = string>(
    opts: WorkflowDefinition<P, M>,
    key: string
  ): IngressWorkflowClient<M>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   */
  objectClient<M, P extends string = string>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressClient<M>;

  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceSendClient<M, P extends string = string>(
    opts: ServiceDefinition<P, M>
  ): IngressSendClient<M>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   */
  objectSendClient<M, P extends string = string>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressSendClient<M>;

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
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: [...P, ...[opts?: Opts]]) => PromiseLike<O>
    : never;
};

type RunArgumentType<M> = M extends Record<string | symbol, unknown>
  ? M["run"] extends (arg: infer I) => Promise<unknown>
    ? I
    : never
  : never;

export type WorkflowInvocation<R> = {
  readonly invocation_id: string;
  readonly key: string;

  output(): Promise<R | undefined>;
  attach(): Promise<R>;
};

export type IngressWorkflowClient<M> = {
  [K in keyof M as Omit<M[K], "run"> extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => PromiseLike<infer O>
    ? (...args: [...P, ...[opts?: Opts]]) => PromiseLike<O>
    : never;
} & {
  submit: (
    argument: RunArgumentType<M>
  ) => Promise<WorkflowInvocation<RunArgumentType<M>>>;
};

export type IngressSendClient<M> = {
  [K in keyof M as M[K] extends never ? never : K]: M[K] extends (
    ...args: infer P
  ) => unknown
    ? (
        ...args: [...P, ...[opts?: SendOpts]]
      ) => Promise<{ invocationId: string }>
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
