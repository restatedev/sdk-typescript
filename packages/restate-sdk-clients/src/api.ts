import type {
  ServiceDefinition,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk";

export interface Ingress {
  serviceClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressClient<M>;
  objectClient<P extends string, M>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressClient<M>;
  objectSendClient<P extends string, M>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressSendClient<M>;
  serviceSendClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressSendClient<M>;

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
  resolveAwakeable<T>(id: string, payload?: T): Promise<void>;

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
  rejectAwakeable(id: string, reason: string): Promise<void>;
}

export interface IngresCallOptions {
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface IngresSendOptions extends IngresCallOptions {
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
  url: string;
  headers?: Record<string, string>;
};
