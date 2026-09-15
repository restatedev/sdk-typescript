/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// Engine-agnostic helpers ported from `@tanstack/workflow-core`'s internal
// `run-workflow.ts` (composeMiddlewares + Standard Schema validation). These are
// pure and carry no dependency on the TanStack replay engine, so we reuse them
// while driving the handler on Restate instead.

import type {
  AnyMiddleware,
  AnyWorkflowDefinition,
  Ctx,
  SchemaInput,
} from "@tanstack/workflow-core";

/**
 * TanStack's own public types are parameterised with `any`
 * (`AnyWorkflowDefinition = WorkflowDefinition<any, any, any>`), so a ctx that
 * accepts any workflow cannot be narrowed without diverging from upstream.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type AnyCtx = Ctx<any, any, any>;

/** The result half of the Standard Schema v1 contract. */
interface StandardResult {
  value?: unknown;
  issues?: ReadonlyArray<{ message: string }>;
}

/**
 * The subset of the Standard Schema v1 contract this adapter relies on, declared
 * locally so the package does not take a dependency on `@standard-schema/spec`
 * for two fields.
 */
interface StandardSchemaLike {
  "~standard": {
    validate: (value: unknown) => StandardResult | Promise<StandardResult>;
  };
}

const reservedCtxFields = new Set([
  "runId",
  "input",
  "state",
  "signal",
  "runtime",
  "step",
  "sleep",
  "sleepUntil",
  "waitForEvent",
  "approve",
  "now",
  "uuid",
  "emit",
]);

/**
 * Thread the middleware chain over a shared, mutable `ctx` object, then call the
 * handler. Each middleware merges its `next({ context })` extension into the
 * same `ctx` reference, so downstream middleware and the handler observe the
 * additions.
 */
export function composeMiddlewares(
  middlewares: ReadonlyArray<AnyMiddleware>,
  ctx: AnyCtx,
  handler: (ctx: AnyCtx) => Promise<unknown>
): Promise<unknown> {
  const compose = async (index: number): Promise<unknown> => {
    if (index >= middlewares.length) return handler(ctx);
    const m = middlewares[index]!;
    let returned: unknown;
    let advanced = false;
    await m.server({
      // `AnyMiddleware.server` takes an `any`-parameterised ctx upstream, so this
      // assignment cannot be made type-safe from this side of the boundary.
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      ctx,
      next: async (opts) => {
        if (advanced) {
          throw new Error(
            "middleware.next() must be called at most once per invocation"
          );
        }
        advanced = true;
        const ext: unknown = opts.context;
        if (ext && typeof ext === "object") {
          for (const key of Object.keys(ext)) {
            if (reservedCtxFields.has(key)) {
              throw new Error(
                `Middleware extension may not shadow reserved ctx field: ${key}`
              );
            }
          }
          Object.assign(ctx, ext);
        }
        returned = await compose(index + 1);
        return returned;
      },
    });
    return returned;
  };
  return compose(0);
}

function validateSyncSchema(
  schema: SchemaInput,
  value: unknown,
  label: string
): unknown {
  const result = (schema as unknown as StandardSchemaLike)[
    "~standard"
  ].validate(value);
  if (result instanceof Promise) {
    throw new Error(
      `${label}: async schema validation is not supported in a durable step boundary`
    );
  }
  if (result.issues) {
    const messages = result.issues.map((i) => i.message).join(", ");
    throw new Error(`${label} validation failed: ${messages}`);
  }
  return result.value;
}

export function validateWorkflowInput(
  def: AnyWorkflowDefinition,
  input: unknown
): unknown {
  if (!def.inputSchema) return input;
  return validateSyncSchema(
    def.inputSchema,
    input,
    `Workflow "${def.id}" input`
  );
}

export function validateWorkflowOutput(
  def: AnyWorkflowDefinition,
  output: unknown
): unknown {
  if (!def.outputSchema) return output;
  return validateSyncSchema(
    def.outputSchema,
    output,
    `Workflow "${def.id}" output`
  );
}

export function validateStandard(
  schema: SchemaInput,
  value: unknown,
  label: string
): unknown {
  return validateSyncSchema(schema, value, label);
}

export function buildInitialState(
  def: AnyWorkflowDefinition,
  input: unknown
): Record<string, unknown> {
  const initial: Record<string, unknown> = def.initialize
    ? def.initialize({ input: input as never })
    : {};
  if (!def.stateSchema) return initial;
  return validateSyncSchema(
    def.stateSchema,
    initial,
    `Workflow "${def.id}" initial state`
  ) as Record<string, unknown>;
}
