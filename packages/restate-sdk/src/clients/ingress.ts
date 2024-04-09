/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { ServiceDefinition, VirtualObjectDefinition } from "../public_api";
import { deserializeJson, serializeJson } from "../utils/serde";

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

/**
 * Connect to the restate Ingress
 *
 * @param opts connection options
 * @returns a connection the the restate ingress
 */
export function connect(opts: ConnectionOpts): Ingress {
  return new HttpIngress(opts);
}

type InvocationParameters<I> = {
  component: string;
  handler: string;
  key?: string;
  send?: boolean;
  opts?: Opts | SendOpts;
  parameter?: I;
};

function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?: Opts | SendOpts;
} {
  let parameter: unknown | undefined;
  let opts: Opts | SendOpts | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0] as Opts;
      } else if (args[0] instanceof SendOpts) {
        opts = args[0] as SendOpts;
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
      parameter = args[0];
      if (args[1] instanceof Opts) {
        opts = args[1] as Opts;
      } else if (args[1] instanceof SendOpts) {
        opts = args[1] as SendOpts;
      } else {
        throw new TypeError(
          "The second argument must be either Opts or SendOpts"
        );
      }
      break;
    }
    default: {
      throw new TypeError("unexpected number of arguments");
    }
  }
  return {
    parameter,
    opts,
  };
}

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export class HttpIngress implements Ingress {
  constructor(readonly opts: ConnectionOpts) {}

  private proxy(component: string, key?: string, send?: boolean) {
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          const handler = prop as string;
          return (...args: unknown[]) => {
            const { parameter, opts } = optsFromArgs(args);
            return this.invoke({
              component,
              handler,
              key,
              parameter,
              opts,
              send,
            });
          };
        },
      }
    );
  }

  async invoke<I, O>(params: InvocationParameters<I>): Promise<O> {
    const fragments = [];
    // ingress URL
    fragments.push(this.opts.url);
    // component
    fragments.push(params.component);
    // has key?
    if (params.key) {
      const key = encodeURIComponent(params.key);
      fragments.push(key);
    }
    // handler
    fragments.push(params.handler);
    if (params.send ?? false) {
      if (params.opts instanceof SendOpts) {
        const sendString = computeDelayAsIso(params.opts);
        fragments.push(sendString);
      } else {
        fragments.push("send");
      }
    }
    const url = fragments.join("/");
    const headers = {
      "Content-Type": "application/json",
      ...(this.opts.headers ?? {}),
      ...(params.opts?.opts?.headers ?? {}),
    };

    const idempotencyKey = params.opts?.opts.idempotencyKey;
    if (idempotencyKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (headers as any)[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
    }
    const body = serializeJson(params.parameter);
    const httpResponse = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (!httpResponse.ok) {
      const body = await httpResponse.text();
      throw new Error(`Request failed: ${httpResponse.status}\n${body}`);
    }
    const responseBuf = await httpResponse.arrayBuffer();
    return deserializeJson(new Uint8Array(responseBuf));
  }

  serviceClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressClient<M> {
    return this.proxy(opts.name) as IngressClient<M>;
  }

  objectClient<P extends string, M>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressClient<M> {
    return this.proxy(opts.name, key) as IngressClient<M>;
  }

  objectSendClient<P extends string, M>(
    opts: VirtualObjectDefinition<P, M>,
    key: string
  ): IngressSendClient<M> {
    return this.proxy(opts.name, key, true) as IngressSendClient<M>;
  }

  serviceSendClient<P extends string, M>(
    opts: ServiceDefinition<P, M>
  ): IngressSendClient<M> {
    return this.proxy(opts.name, undefined, true) as IngressSendClient<M>;
  }

  async resolveAwakeable<T>(
    id: string,
    payload?: T | undefined
  ): Promise<void> {
    const url = `${this.opts.url}/restate/a/${id}/resolve`;
    const headers = {
      "Content-Type": "application/json",
      ...(this.opts.headers ?? {}),
    };
    const body = serializeJson(payload);
    const httpResponse = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (!httpResponse.ok) {
      const body = await httpResponse.text();
      throw new Error(`Request failed: ${httpResponse.status}\n${body}`);
    }
  }

  async rejectAwakeable(id: string, reason: string): Promise<void> {
    const url = `${this.opts.url}/restate/a/${id}/reject`;
    const headers = {
      "Content-Type": "text/plain",
      ...(this.opts.headers ?? {}),
    };
    const httpResponse = await fetch(url, {
      method: "POST",
      headers,
      body: reason,
    });
    if (!httpResponse.ok) {
      const body = await httpResponse.text();
      throw new Error(`Request failed: ${httpResponse.status}\n${body}`);
    }
  }
}

function computeDelayAsIso(opts: SendOpts): string {
  const delay = opts.delay();
  if (!delay) {
    return "send";
  }
  if (delay >= 1000) {
    const delaySec = delay / 1000;
    return `send?delaySec=${delaySec}`;
  }
  const delayStr = String(delay).padStart(3);
  return `send?delay=PT0.${delayStr}0S`;
}
