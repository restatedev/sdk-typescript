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
  context,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
  type TextMapGetter,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  internal,
  type HooksProvider,
  type Request,
} from "@restatedev/restate-sdk";

export interface OpenTelemetryHookContext {
  request: Request;
}

export interface OpenTelemetryHookOptions {
  /**
   * Tracer used to create Restate spans.
   *
   * You can pass a single tracer instance, or resolve one per request
   * (for example to vary the instrumentation scope by service).
   */
  tracer: Tracer | ((ctx: OpenTelemetryHookContext) => Tracer);

  /**
   * When `true`, create child spans for `ctx.run()` closures that actually
   * execute. Replayed journaled runs are skipped by the hook system.
   *
   * @default true
   */
  runSpans?: boolean;

  /**
   * When `true`, suppress span events added to the attempt span while the
   * invocation is replaying journaled work. Attributes are still recorded.
   *
   * This affects only the attempt span; `ctx.run()` spans are only created
   * when the run closure actually executes.
   *
   * @default true
   */
  suppressSpanEventsDuringReplay?: boolean;

  /**
   * Additional attempt span attributes to attach alongside the standard
   * Restate attributes.
   */
  additionalAttemptAttributes?:
    | Attributes
    | ((ctx: OpenTelemetryHookContext) => Attributes | undefined);

  /**
   * Additional `ctx.run()` span attributes to attach alongside
   * `restate.run.name`.
   */
  additionalRunAttributes?:
    | Attributes
    | ((ctx: OpenTelemetryHookContext, name: string) => Attributes | undefined);
}

// Hidden symbol key injected by the Restate SDK when instantiating hooks.
// This is intentionally not part of the public hook context contract.
const HOOK_CONTEXT_IS_PROCESSING_SYMBOL = Symbol.for(
  "@restatedev/restate-sdk/hooks.isProcessing"
);

const attemptHeadersGetter: TextMapGetter<
  ReadonlyMap<string, string | string[] | undefined>
> = {
  get(carrier, key) {
    const value = carrier.get(key);
    if (Array.isArray(value)) {
      return value[0];
    }
    return value ?? undefined;
  },

  keys(carrier) {
    return [...carrier.keys()];
  },
};

const traceContextPropagator = new W3CTraceContextPropagator();

function resolveTracer(
  tracer: OpenTelemetryHookOptions["tracer"],
  ctx: OpenTelemetryHookContext
): Tracer {
  return typeof tracer === "function" ? tracer(ctx) : tracer;
}

function resolveAttributes<TArgs extends unknown[]>(
  source: Attributes | ((...args: TArgs) => Attributes | undefined) | undefined,
  ...args: TArgs
): Attributes | undefined {
  if (typeof source === "function") {
    return source(...args);
  }
  return source;
}

function getExceptionMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function getExceptionValue(error: unknown): Error | string {
  return error instanceof Error ? error : getExceptionMessage(error);
}

function getIsProcessing(ctx: OpenTelemetryHookContext): () => boolean {
  const isProcessing = (ctx as unknown as Record<PropertyKey, unknown>)[
    HOOK_CONTEXT_IS_PROCESSING_SYMBOL
  ];
  return typeof isProcessing === "function"
    ? (isProcessing as () => boolean)
    : () => true;
}

function wrapSpanSuppressingReplayEvents(
  span: Span,
  isProcessing: () => boolean
): Span {
  const wrapped: Span = {
    spanContext: () => span.spanContext(),
    setAttribute: (key, value) => {
      span.setAttribute(key, value);
      return wrapped;
    },
    setAttributes: (attributes) => {
      span.setAttributes(attributes);
      return wrapped;
    },
    addEvent: (name, attributesOrStartTime, startTime) => {
      if (isProcessing()) {
        span.addEvent(name, attributesOrStartTime, startTime);
      }
      return wrapped;
    },
    addLink: (link) => {
      span.addLink(link);
      return wrapped;
    },
    addLinks: (links) => {
      span.addLinks(links);
      return wrapped;
    },
    setStatus: (status) => {
      span.setStatus(status);
      return wrapped;
    },
    updateName: (name) => {
      span.updateName(name);
      return wrapped;
    },
    end: (endTime) => {
      span.end(endTime);
    },
    isRecording: () => span.isRecording(),
    recordException: (exception, time) => {
      if (isProcessing()) {
        span.recordException(exception, time);
      }
    },
  };

  return wrapped;
}

/**
 * Creates a HooksProvider that integrates Restate invocations with
 * OpenTelemetry tracing using the SDK hook system.
 *
 * The helper always creates one span per invocation attempt, with the standard
 * Restate attributes `restate.invocation.id` and
 * `restate.invocation.target`. Parent context extraction is always based on
 * W3C trace context headers from the Restate attempt headers.
 *
 * When `runSpans` is enabled, it also creates child spans for `ctx.run()`
 * closures that actually execute, adding the standard `restate.run.name`
 * attribute.
 */
export function openTelemetryHook(
  options: OpenTelemetryHookOptions
): HooksProvider {
  return (ctx) => {
    const runSpans = options.runSpans ?? true;
    const suppressSpanEventsDuringReplay =
      options.suppressSpanEventsDuringReplay ?? true;
    const tracer = resolveTracer(options.tracer, ctx);
    const isProcessing = getIsProcessing(ctx);
    const parentContext = traceContextPropagator.extract(
      context.active(),
      ctx.request.attemptHeaders,
      attemptHeadersGetter
    );

    const target = String(ctx.request.target);
    const attemptSpan = tracer.startSpan(
      `attempt ${target}`,
      {
        attributes: {
          ...resolveAttributes(options.additionalAttemptAttributes, ctx),
          "restate.invocation.id": ctx.request.id,
          "restate.invocation.target": target,
        },
      },
      parentContext
    );
    const attemptContext = trace.setSpan(
      parentContext,
      suppressSpanEventsDuringReplay
        ? wrapSpanSuppressingReplayEvents(attemptSpan, isProcessing)
        : attemptSpan
    );

    const hooks: ReturnType<HooksProvider> = {
      interceptor: {
        handler: async (next) => {
          try {
            await context.with(attemptContext, next);
            attemptSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (e) {
            if (!internal.isSuspendedError(e)) {
              attemptSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: getExceptionMessage(e),
              });
              attemptSpan.recordException(getExceptionValue(e));
            }
            throw e;
          } finally {
            attemptSpan.end();
          }
        },
      },
    };

    if (runSpans) {
      hooks.interceptor!.run = (name, next) => {
        const runSpan = tracer.startSpan(
          `run (${name})`,
          {
            attributes: {
              ...resolveAttributes(options.additionalRunAttributes, ctx, name),
              "restate.run.name": name,
            },
          },
          attemptContext
        );
        const runContext = trace.setSpan(attemptContext, runSpan);

        return context.with(runContext, async () => {
          try {
            await next();
            runSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (e) {
            if (!internal.isSuspendedError(e)) {
              runSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: getExceptionMessage(e),
              });
              runSpan.recordException(getExceptionValue(e));
            }
            throw e;
          } finally {
            runSpan.end();
          }
        });
      };
    }

    return hooks;
  };
}
