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

import type {
  ServiceDefinition,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk-core";
import type {
  ConnectionOpts,
  Ingress,
  IngressClient,
  IngressSendClient,
} from "./api";

import { Opts, SendOpts } from "./api";

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

class HttpIngress implements Ingress {
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

function serializeJson(what: unknown): Uint8Array {
  if (what === undefined) {
    return new Uint8Array();
  }
  const json = JSON.stringify(what);
  return new TextEncoder().encode(json);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeJson(what: Uint8Array): any | undefined {
  if (what === undefined || what.length == 0) {
    return undefined;
  }
  const json = new TextDecoder().decode(what);
  return JSON.parse(json);
}
