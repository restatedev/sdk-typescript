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

import {
  type Service,
  type ServiceDefinitionFrom,
  type VirtualObject,
  type WorkflowDefinitionFrom,
  type Workflow,
  type VirtualObjectDefinitionFrom,
  type Serde,
  serde,
} from "@restatedev/restate-sdk-core";
import type {
  ConnectionOpts,
  Ingress,
  IngressClient,
  IngressSendClient,
  IngressWorkflowClient,
  Output,
  Send,
  WorkflowSubmission,
} from "./api.js";

import { Opts, SendOpts } from "./api.js";

/**
 * Connect to the restate Ingress
 *
 * @param opts connection options
 * @returns a connection the the restate ingress
 */
export function connect(opts: ConnectionOpts): Ingress {
  return new HttpIngress(opts);
}

export class HttpCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseText: string,
    public readonly message: string
  ) {
    super(message);
  }
}

type InvocationParameters<I> = {
  component: string;
  handler: string;
  key?: string;
  send?: boolean;
  opts?: Opts<I, unknown> | SendOpts<I>;
  parameter?: I;
  method?: string;
};

function optsFromArgs(args: unknown[]): {
  parameter?: unknown;
  opts?: Opts<unknown, unknown> | SendOpts<unknown>;
} {
  let parameter: unknown;
  let opts: Opts<unknown, unknown> | SendOpts<unknown> | undefined;
  switch (args.length) {
    case 0: {
      break;
    }
    case 1: {
      if (args[0] instanceof Opts) {
        opts = args[0];
      } else if (args[0] instanceof SendOpts) {
        opts = args[0];
      } else {
        parameter = args[0];
      }
      break;
    }
    case 2: {
      parameter = args[0];
      if (args[1] instanceof Opts) {
        opts = args[1];
      } else if (args[1] instanceof SendOpts) {
        opts = args[1];
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

const doComponentInvocation = async <I, O>(
  opts: ConnectionOpts,
  params: InvocationParameters<I>
): Promise<O> => {
  let attachable = false;
  const fragments = [];
  //
  // ingress URL
  //
  fragments.push(opts.url);
  //
  // component
  //
  fragments.push(params.component);
  //
  // has key?
  //
  if (params.key) {
    const key = encodeURIComponent(params.key);
    fragments.push(key);
  }
  //
  // handler
  //
  fragments.push(params.handler);
  if (params.send ?? false) {
    if (params.opts instanceof SendOpts) {
      const sendString = computeDelayAsIso(params.opts);
      fragments.push(sendString);
    } else {
      fragments.push("send");
    }
  }
  const raw: boolean = params.opts?.opts.raw ?? false;
  //
  // request body
  //
  let inputSerde = params.opts?.opts.input;
  if (!inputSerde) {
    inputSerde = raw ? serde.binary : serde.json;
  }

  const { body, contentType } = serializeBodyWithContentType(
    params.parameter,
    inputSerde
  );
  //
  // headers
  //
  const headers = {
    ...(opts.headers ?? {}),
    ...(params.opts?.opts?.headers ?? {}),
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  //
  //idempotency
  //
  const idempotencyKey = params.opts?.opts.idempotencyKey;
  if (idempotencyKey) {
    headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
    attachable = true;
  }
  //
  // make the call
  //
  const url = fragments.join("/");
  const httpResponse = await fetch(url, {
    method: params.method ?? "POST",
    headers,
    body,
  });
  if (!httpResponse.ok) {
    const body = await httpResponse.text();
    throw new HttpCallError(
      httpResponse.status,
      body,
      `Request failed: ${httpResponse.status}\n${body}`
    );
  }
  const responseBuf = await httpResponse.arrayBuffer();
  if (!params.send) {
    const outputSerde =
      params.opts?.opts.output ?? (raw ? serde.binary : serde.json);
    return outputSerde.deserialize(new Uint8Array(responseBuf)) as O;
  }
  const json = serde.json.deserialize(new Uint8Array(responseBuf)) as O;
  return { ...json, attachable };
};

const doWorkflowHandleCall = async <O>(
  opts: ConnectionOpts,
  wfName: string,
  wfKey: string,
  op: "output" | "attach",
  callOpts?: Opts<unknown, O> | SendOpts<unknown>
): Promise<O> => {
  const outputSerde = callOpts?.opts.output ?? serde.json;
  //
  // headers
  //
  const headers = {
    ...(opts.headers ?? {}),
  };
  //
  // make the call
  //
  const url = `${opts.url}/restate/workflow/${wfName}/${encodeURIComponent(
    wfKey
  )}/${op}`;

  const httpResponse = await fetch(url, {
    method: "GET",
    headers,
  });
  if (httpResponse.ok) {
    const responseBuf = await httpResponse.arrayBuffer();
    return outputSerde.deserialize(new Uint8Array(responseBuf)) as O;
  }
  const body = await httpResponse.text();
  throw new HttpCallError(
    httpResponse.status,
    body,
    `Request failed: ${httpResponse.status}\n${body}`
  );
};

class HttpIngress implements Ingress {
  constructor(private readonly opts: ConnectionOpts) {}

  private proxy(component: string, key?: string, send?: boolean) {
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          const handler = prop as string;
          return (...args: unknown[]) => {
            const { parameter, opts } = optsFromArgs(args);
            return doComponentInvocation<unknown, unknown>(this.opts, {
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

  serviceClient<D>(opts: ServiceDefinitionFrom<D>): IngressClient<Service<D>> {
    return this.proxy(opts.name) as IngressClient<Service<D>>;
  }

  objectClient<D>(
    opts: VirtualObjectDefinitionFrom<D>,
    key: string
  ): IngressClient<VirtualObject<D>> {
    return this.proxy(opts.name, key) as IngressClient<VirtualObject<D>>;
  }

  workflowClient<D>(
    opts: WorkflowDefinitionFrom<D>,
    key: string
  ): IngressWorkflowClient<Workflow<D>> {
    const component = opts.name;
    const conn = this.opts;

    const workflowSubmit = async (
      parameter?: unknown,
      opts?: SendOpts<unknown>
    ): Promise<WorkflowSubmission<unknown>> => {
      const res: Send = await doComponentInvocation(conn, {
        component,
        handler: "run",
        key,
        send: true,
        parameter,
        opts,
      });

      return {
        invocationId: res.invocationId,
        status: res.status,
        attachable: true,
      };
    };

    const workflowAttach = (opts?: Opts<void, unknown>) =>
      doWorkflowHandleCall(conn, component, key, "attach", opts);

    const workflowOutput = async (
      opts?: Opts<void, unknown>
    ): Promise<Output<unknown>> => {
      try {
        const result = await doWorkflowHandleCall(
          conn,
          component,
          key,
          "output",
          opts
        );

        return {
          ready: true,
          result,
        };
      } catch (e) {
        if (!(e instanceof HttpCallError) || e.status != 470) {
          throw e;
        }
        return {
          ready: false,
          get result() {
            throw new Error("Calling result() on a non ready workflow");
          },
        };
      }
    };

    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          const handler = prop as string;
          if (handler == "workflowSubmit") {
            return workflowSubmit;
          } else if (handler == "workflowAttach") {
            return workflowAttach;
          } else if (handler == "workflowOutput") {
            return workflowOutput;
          }
          // shared handlers pass trough via the ingress's normal invocation form
          // i.e. POST /<svc>/<key>/<handler>
          return (...args: unknown[]) => {
            const { parameter, opts } = optsFromArgs(args);
            return doComponentInvocation(conn, {
              component,
              handler,
              key,
              parameter,
              opts,
            });
          };
        },
      }
    ) as IngressWorkflowClient<Workflow<D>>;
  }

  objectSendClient<D>(
    opts: VirtualObjectDefinitionFrom<D>,
    key: string
  ): IngressSendClient<VirtualObject<D>> {
    return this.proxy(opts.name, key, true) as IngressSendClient<
      VirtualObject<D>
    >;
  }

  serviceSendClient<D>(
    opts: ServiceDefinitionFrom<D>
  ): IngressSendClient<Service<D>> {
    return this.proxy(opts.name, undefined, true) as IngressSendClient<
      Service<D>
    >;
  }

  async resolveAwakeable<T>(
    id: string,
    payload?: T | undefined,
    payloadSerde?: Serde<T>
  ): Promise<void> {
    const url = `${this.opts.url}/restate/a/${id}/resolve`;
    const { body, contentType } = serializeBodyWithContentType(
      payload,
      payloadSerde ?? serde.json
    );
    const headers = {
      ...(this.opts.headers ?? {}),
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    const httpResponse = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (!httpResponse.ok) {
      const body = await httpResponse.text();
      throw new HttpCallError(
        httpResponse.status,
        body,
        `Request failed: ${httpResponse.status}\n${body}`
      );
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
      throw new HttpCallError(
        httpResponse.status,
        body,
        `Request failed: ${httpResponse.status}\n${body}`
      );
    }
  }

  async result<T>(
    send: Send<T> | WorkflowSubmission<T>,
    resultSerde?: Serde<T>
  ): Promise<T> {
    if (!send.attachable) {
      throw new Error(
        `Unable to fetch the result for ${send.invocationId}.
        A service's result is stored only with an idempotencyKey is supplied when invocating the service.`
      );
    }
    //
    // headers
    //
    const headers = {
      ...(this.opts.headers ?? {}),
    };
    //
    // make the call
    const url = `${this.opts.url}/restate/invocation/${send.invocationId}/attach`;

    const httpResponse = await fetch(url, {
      method: "GET",
      headers,
    });
    if (httpResponse.ok) {
      const responseBuf = await httpResponse.arrayBuffer();
      const ser = resultSerde ?? serde.json;
      return ser.deserialize(new Uint8Array(responseBuf)) as T;
    }
    const body = await httpResponse.text();
    throw new HttpCallError(
      httpResponse.status,
      body,
      `Request failed: ${httpResponse.status}\n${body}`
    );
  }
}

function computeDelayAsIso(opts: SendOpts): string {
  const delay = opts.delay();
  if (!delay) {
    return "send";
  }
  return `send?delay=${delay}ms`;
}

function serializeBodyWithContentType(
  body: unknown,
  serde: Serde<unknown>
): {
  body?: Uint8Array;
  contentType?: string;
} {
  if (body === undefined) {
    return {};
  }
  const buffer = serde.serialize(body);
  return {
    body: buffer,
    contentType: serde.contentType,
  };
}
