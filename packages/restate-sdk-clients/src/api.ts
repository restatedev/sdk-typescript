import type {
  ServiceDefinition,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk";

export interface Ingress {
  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressClient<M>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   */
  objectClient<P extends string, M>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressClient<M>;

  /**
   * Create a client from a {@link ServiceDefinition}.
   */
  serviceSendClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressSendClient<M>;

  /**
   * Create a client from a {@link VirtualObjectDefinition}.
   */
  objectSendClient<P extends string, M>(
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
