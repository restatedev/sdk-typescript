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

import { ServiceDefintion, VirtualObjectDefintion } from "../public_api";
import { deserializeJson, serializeJson } from "../utils/serde";

export interface Ingress {
  service<P extends string, M>(opts: ServiceDefintion<P, M>): IngressClient<M>;
  object<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): IngressClient<M>;
  objectSend<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): IngressSendClient<M>;
  serviceSend<P extends string, M>(
    opts: ServiceDefintion<P, M>
  ): IngressSendClient<M>;
}

export interface IngresCallOptions {
  idempotencyKey?: string;
  retain?: number;
  headers?: Record<string, string>;
}

export class Opts {
  public static from(opts: IngresCallOptions): Opts {
    return new Opts(opts);
  }

  constructor(readonly opts: IngresCallOptions) {}
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
    ? (...args: [...P, ...[opts?: Opts]]) => void
    : never;
};

export type ConnectionOpts = {
  url: string;
  headers?: Record<string, string>;
};

export function connect(opts: ConnectionOpts): Ingress {
  return new HttpIngress(opts);
}

type InvocationParameters<I> = {
  component: string;
  handler: string;
  key?: string;
  send?: boolean;
  delay?: number;
  opts?: Opts;
  parameter?: I;
};

function optsFromArgs(args: unknown[]): { parameter?: unknown; opts?: Opts } {
  let parameter: unknown | undefined;
  let opts: Opts | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0] as Opts;
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
      parameter = args[0];
      opts = args[1] as Opts;
      break;
    }
    default: {
      throw new TypeError(`unexpected number of arguments`);
    }
  }
  return {
    parameter,
    opts,
  };
}

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY_RETAIN_HEADER = "idempotency-retention-period";

export class HttpIngress implements Ingress {
  constructor(readonly opts: ConnectionOpts) {}

  private proxy(
    component: string,
    key?: string,
    send?: boolean,
    delay?: number
  ) {
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
              delay,
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
      if (params.delay) {
        fragments.push(`send?delay=${params.delay}`);
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
    const retain = params.opts?.opts.retain;
    if (retain) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (headers as any)[IDEMPOTENCY_KEY_RETAIN_HEADER] = `${retain}`;
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

  service<P extends string, M>(opts: ServiceDefintion<P, M>): IngressClient<M> {
    return this.proxy(opts.path) as IngressClient<M>;
  }

  object<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): IngressClient<M> {
    return this.proxy(opts.path, key) as IngressClient<M>;
  }

  objectSend<P extends string, M>(
    opts: VirtualObjectDefintion<P, M>,
    key: string
  ): IngressSendClient<M> {
    return this.proxy(opts.path, key, true) as IngressSendClient<M>;
  }

  serviceSend<P extends string, M>(
    opts: ServiceDefintion<P, M>
  ): IngressSendClient<M> {
    return this.proxy(opts.path, undefined, true) as IngressSendClient<M>;
  }
}
