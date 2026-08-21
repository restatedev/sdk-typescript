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
  type JournalValueCodec,
} from "@restatedev/restate-sdk-core";
import {
  ConnectionOpts,
  Ingress,
  IngressClient,
  IngressSendClient,
  IngressWorkflowClient,
  Output,
  Send,
  ScopedIngress,
  WorkflowSubmission,
} from "./api.js";

import { Opts, SendOpts } from "./api.js";
import {
  abortableSleep,
  backoffDelay,
  defaultShouldRetry,
  parseRetryAfter,
  type ResolvedRetryPolicy,
  resolveRetryPolicy,
} from "./retry.js";

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
    public override readonly message: string
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
  scope?: string;
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
const LIMIT_KEY_HEADER = "x-restate-limit-key";
// Carries the 1-based attempt number on every request so the server can observe
// how many times the client has (re)issued it.
const ATTEMPT_HEADER = "x-restateclient-retry-attempt";

const getFetch = (opts: ConnectionOpts): NonNullable<ConnectionOpts["fetch"]> =>
  opts.fetch ?? globalThis.fetch;

const fetchWithRetries = async (
  opts: ConnectionOpts,
  url: string,
  init: RequestInit,
  callOpts: Opts<unknown, unknown> | SendOpts<unknown> | undefined,
  retryPolicy: ResolvedRetryPolicy | undefined
): Promise<Uint8Array> => {
  const userSignal = callOpts?.opts.signal;
  const timeout = callOpts?.opts.timeout;
  if (userSignal !== undefined && timeout !== undefined) {
    // The caller configured two mutually exclusive ways to abort each attempt.
    throw new Error(
      "You can't specify both signal and timeout options at the same time"
    );
  }
  // A fresh timeout signal is minted per attempt below — a single
  // AbortSignal.timeout() would already be aborted on the second attempt.
  const attemptSignal = (): AbortSignal | undefined =>
    userSignal ??
    (timeout !== undefined ? AbortSignal.timeout(timeout) : undefined);
  const shouldRetry = retryPolicy?.shouldRetry ?? defaultShouldRetry;

  // Whether waiting `delay` and then starting the next attempt would still fall
  // within the maxDuration budget (measured from the first attempt; a non-finite
  // maxDuration disables the bound). Checked *after* the delay is known so we
  // never sleep out a backoff — or a long Retry-After — only to give up on the
  // attempt it precedes. This is a decision-time gate only: it never aborts an
  // in-flight request. The maxAttempts count is gated separately, before the
  // delay is computed.
  const startTime = Date.now();
  const nextAttemptFitsBudget = (
    policy: ResolvedRetryPolicy,
    delay: number
  ): boolean => Date.now() - startTime + delay < policy.maxDuration;

  // Headers are always a plain record in this codebase; carry them forward and
  // stamp the attempt number afresh on each try.
  const baseHeaders = (init.headers ?? {}) as Record<string, string>;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    let errorBody: string;
    try {
      response = await getFetch(opts)(url, {
        ...init,
        headers: { ...baseHeaders, [ATTEMPT_HEADER]: String(attempt + 1) },
        signal: attemptSignal(),
      });
      if (response.ok) {
        // A 2xx response was received. Keep the body read inside this try so a
        // connection failure while streaming the body is retried as ambiguous.
        return new Uint8Array(await response.arrayBuffer());
      }
      // fetch resolves normally for non-2xx statuses. Read the body here both
      // for RetryFailure inspection and the final HttpCallError.
      errorBody = await response.text();
    } catch (e) {
      // fetch rejected, or the response body failed while streaming. Both are
      // ambiguous because the server may already have processed the request.
      if (
        retryPolicy &&
        attempt < retryPolicy.maxAttempts - 1 &&
        !userSignal?.aborted &&
        shouldRetry({ kind: "network", error: e }, attempt)
      ) {
        // Retries are enabled, attempts remain, the caller did not abort, and
        // the policy accepted this failure. Retry only if the backoff still
        // leaves us within the duration budget.
        const delay = backoffDelay(retryPolicy, attempt);
        if (nextAttemptFitsBudget(retryPolicy, delay)) {
          await abortableSleep(delay, userSignal);
          continue;
        }
      }
      // Retries are disabled or exhausted, the caller aborted, the policy
      // rejected this failure, or the duration budget is spent.
      throw e;
    }
    if (
      retryPolicy &&
      attempt < retryPolicy.maxAttempts - 1 &&
      !userSignal?.aborted &&
      shouldRetry(
        {
          kind: "response",
          status: response.status,
          headers: response.headers,
          body: errorBody || undefined,
        },
        attempt
      )
    ) {
      // A non-2xx response was received, attempts remain, and the policy chose
      // to retry it (by default, transient statuses 408/425/429/5xx, unless the
      // error is attributed to the invocation via x-restate-error-source). The
      // delay is the server's Retry-After when present, else the computed
      // backoff; either way we only retry if it still fits the duration budget.
      const retryAfter = retryPolicy.respectRetryAfter
        ? parseRetryAfter(response.headers)
        : undefined;
      const delay = retryAfter ?? backoffDelay(retryPolicy, attempt);
      if (nextAttemptFitsBudget(retryPolicy, delay)) {
        await abortableSleep(delay, userSignal);
        continue;
      }
    }
    // The response is not retryable, retries are disabled or exhausted, the
    // caller aborted, or the policy rejected this response.
    throw new HttpCallError(
      response.status,
      errorBody,
      `Request failed: ${response.status}\n${errorBody}`
    );
  }
};

const doComponentInvocation = async <I, O>(
  opts: ConnectionOpts,
  params: InvocationParameters<I>,
  canBeRetried = Boolean(params.opts?.opts.idempotencyKey)
): Promise<O> => {
  let attachable = false;
  //
  // ingress URL
  //
  let url: string;
  if (params.scope) {
    // Scoped path: /restate/scope/{scope}/{call|send}/{service}/{key?}/{handler}
    const pathType = params.send ? "send" : "call";
    const parts = [
      opts.url,
      "restate/scope",
      encodeURIComponent(params.scope),
      pathType,
      params.component,
    ];
    if (params.key) {
      parts.push(encodeURIComponent(params.key));
    }
    parts.push(params.handler);
    url = parts.join("/");
    if (params.send && params.opts instanceof SendOpts) {
      const delay = params.opts.delay();
      if (delay) url += `?delay=${delay}ms`;
    }
  } else {
    const fragments = [opts.url, params.component];
    if (params.key) {
      fragments.push(encodeURIComponent(params.key));
    }
    fragments.push(params.handler);
    if (params.send ?? false) {
      if (params.opts instanceof SendOpts) {
        fragments.push(computeDelayAsIso(params.opts));
      } else {
        fragments.push("send");
      }
    }
    url = fragments.join("/");
  }
  //
  // request body
  //
  const inputSerde = params.opts?.opts.input ?? opts.serde ?? serde.json;

  const { body, contentType } = serializeBodyWithContentType(
    params.parameter,
    inputSerde,
    opts.journalValueCodec
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
  // idempotency
  //
  const idempotencyKey = params.opts?.opts.idempotencyKey;
  if (idempotencyKey) {
    headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
    attachable = true;
  }
  //
  // limit key
  //
  const limitKey = params.opts?.opts.limitKey;
  if (limitKey) {
    headers[LIMIT_KEY_HEADER] = limitKey;
  }

  //
  // retries
  //
  // Regular invocations default eligibility from the idempotency key, while
  // workflow submissions opt in because the workflow ID identifies the run.
  const retryPolicy = canBeRetried ? resolveRetryPolicy(opts.retry) : undefined;

  //
  // make the call
  //
  const responseBuf = await fetchWithRetries(
    opts,
    url,
    {
      method: params.method ?? "POST",
      headers,
      body,
    },
    params.opts,
    retryPolicy
  );
  if (!params.send) {
    const decodedBuf = opts.journalValueCodec
      ? await opts.journalValueCodec.decode(responseBuf)
      : responseBuf;
    const outputSerde = params.opts?.opts.output ?? opts.serde ?? serde.json;
    return outputSerde.deserialize(decodedBuf) as O;
  }
  const json = serde.json.deserialize(responseBuf) as O;
  return { ...json, attachable };
};

const doWorkflowHandleCall = async <O>(
  opts: ConnectionOpts,
  wfName: string,
  wfKey: string,
  op: "output" | "attach",
  callOpts?: Opts<unknown, O> | SendOpts<unknown>
): Promise<O> => {
  const outputSerde = callOpts?.opts.output ?? opts.serde ?? serde.json;
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
  // Attach and output only observe the existing workflow, so both are eligible
  // when the connection has a retry policy.
  const retryPolicy = resolveRetryPolicy(opts.retry);

  const responseBuf = await fetchWithRetries(
    opts,
    url,
    { method: "GET", headers },
    callOpts,
    retryPolicy
  );
  const decodedBuf = opts.journalValueCodec
    ? await opts.journalValueCodec.decode(responseBuf)
    : responseBuf;
  return outputSerde.deserialize(decodedBuf) as O;
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
      ...args: unknown[]
    ): Promise<WorkflowSubmission<unknown>> => {
      const { parameter, opts } = optsFromArgs(args);
      const res: Send = await doComponentInvocation(
        conn,
        {
          component,
          handler: "run",
          key,
          send: true,
          parameter,
          opts,
        },
        true
      );

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
        if (!(e instanceof HttpCallError) || e.status !== 470) {
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
          if (handler === "workflowSubmit") {
            return workflowSubmit;
          } else if (handler === "workflowAttach") {
            return workflowAttach;
          } else if (handler === "workflowOutput") {
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

  scope(scopeKey: string): ScopedIngress {
    const conn = this.opts;
    const scopedProxy = (component: string, key?: string, send?: boolean) =>
      new Proxy(
        {},
        {
          get: (_target, prop) => {
            const handler = prop as string;
            return (...args: unknown[]) => {
              const { parameter, opts } = optsFromArgs(args);
              return doComponentInvocation<unknown, unknown>(conn, {
                component,
                handler,
                key,
                parameter,
                opts,
                send,
                scope: scopeKey,
              });
            };
          },
        }
      );

    return {
      serviceClient: <D>(opts: ServiceDefinitionFrom<D>) =>
        scopedProxy(opts.name) as IngressClient<Service<D>>,
      serviceSendClient: <D>(opts: ServiceDefinitionFrom<D>) =>
        scopedProxy(opts.name, undefined, true) as IngressSendClient<
          Service<D>
        >,
      objectClient: <D>(opts: VirtualObjectDefinitionFrom<D>, key: string) =>
        scopedProxy(opts.name, key) as IngressClient<VirtualObject<D>>,
      objectSendClient: <D>(
        opts: VirtualObjectDefinitionFrom<D>,
        key: string
      ) =>
        scopedProxy(opts.name, key, true) as IngressSendClient<
          VirtualObject<D>
        >,
      workflowClient: <D>(
        opts: WorkflowDefinitionFrom<D>,
        key: string
      ): IngressWorkflowClient<Workflow<D>> => {
        const component = opts.name;

        const workflowSubmit = async (
          ...args: unknown[]
        ): Promise<WorkflowSubmission<unknown>> => {
          const { parameter, opts } = optsFromArgs(args);
          const res: Send = await doComponentInvocation(
            conn,
            {
              component,
              handler: "run",
              key,
              send: true,
              parameter,
              opts,
              scope: scopeKey,
            },
            true
          );
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
            return { ready: true, result };
          } catch (e) {
            if (!(e instanceof HttpCallError) || e.status !== 470) {
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
              if (handler === "workflowSubmit") {
                return workflowSubmit;
              } else if (handler === "workflowAttach") {
                return workflowAttach;
              } else if (handler === "workflowOutput") {
                return workflowOutput;
              }
              return (...args: unknown[]) => {
                const { parameter, opts } = optsFromArgs(args);
                return doComponentInvocation(conn, {
                  component,
                  handler,
                  key,
                  parameter,
                  opts,
                  scope: scopeKey,
                });
              };
            },
          }
        ) as IngressWorkflowClient<Workflow<D>>;
      },
    };
  }

  async call<I, O>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    scope?: string;
    opts?: Opts<I, O>;
  }): Promise<O> {
    return doComponentInvocation<I, O>(this.opts, {
      component: opts.service,
      handler: opts.handler,
      key: opts.key,
      scope: opts.scope,
      parameter: opts.parameter,
      send: false,
      opts: opts.opts,
    });
  }

  async send<I>(opts: {
    service: string;
    handler: string;
    parameter: I;
    key?: string;
    scope?: string;
    opts?: SendOpts<I>;
  }): Promise<Send> {
    return doComponentInvocation<I, Send>(this.opts, {
      component: opts.service,
      handler: opts.handler,
      key: opts.key,
      scope: opts.scope,
      parameter: opts.parameter,
      send: true,
      opts: opts.opts,
    });
  }

  async resolveAwakeable<T>(
    id: string,
    payload?: T,
    payloadSerde?: Serde<T>
  ): Promise<void> {
    const url = `${this.opts.url}/restate/a/${id}/resolve`;
    const { body, contentType } = serializeBodyWithContentType(
      payload,
      payloadSerde ?? this.opts.serde ?? serde.json,
      this.opts.journalValueCodec
    );
    const headers = {
      ...(this.opts.headers ?? {}),
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    const httpResponse = await getFetch(this.opts)(url, {
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
    const httpResponse = await getFetch(this.opts)(url, {
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
    //
    const url = `${this.opts.url}/restate/invocation/${send.invocationId}/attach`;
    // Attaching only observes the existing invocation, so it is safe to retry
    // when the connection has a retry policy.
    const retryPolicy = resolveRetryPolicy(this.opts.retry);

    const responseBuf = await fetchWithRetries(
      this.opts,
      url,
      { method: "GET", headers },
      undefined,
      retryPolicy
    );
    const decodedBuf = this.opts.journalValueCodec
      ? await this.opts.journalValueCodec.decode(responseBuf)
      : responseBuf;
    return (resultSerde ?? this.opts.serde ?? serde.json).deserialize(
      decodedBuf
    ) as T;
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
  serde: Serde<unknown>,
  journalValueCodec?: JournalValueCodec
): {
  body?: Uint8Array;
  contentType?: string;
} {
  let buffer = serde.serialize(body);
  if (journalValueCodec) {
    buffer = journalValueCodec.encode(buffer);
  }
  return {
    body: buffer,
    contentType: serde.contentType,
  };
}
