---
name: add-config-option
description: When the user asks to add a new option/field/config to service, handler, endpoint, ServiceOptions, HandlerOpts, ObjectOptions, WorkflowOptions, or the discovery schema
user-invocable: false
---

# Adding a config option to the Restate TypeScript SDK

There are two kinds of config options:

1. **Discovery options** — sent to the Restate server during service discovery (e.g. `ingressPrivate`, `enableLazyState`, timeouts). These need to be in the discovery schema.
2. **Runtime-only options** — used only by the SDK at execution time, never sent to the server (e.g. `asTerminalError`, `serde`). These skip the discovery layer entirely.

Ask the user which kind if unclear.

## All options: Type definitions — `packages/libs/restate-sdk/src/types/rpc.ts`

1. **`ServiceHandlerOpts<I, O>`** — add the field with JSDoc. All handler types inherit this.
   - If object/workflow-only (like `enableLazyState`): add to `ObjectHandlerOpts` / `WorkflowHandlerOpts` instead.
2. **`ServiceOptions`** — add the field with JSDoc.
   - If object/workflow-only: add to `ObjectOptions` / `WorkflowOptions` instead.
   - `DefaultServiceOptions` in `endpoint.ts` = `ServiceOptions & ObjectOptions & WorkflowOptions`, so endpoint-level gets it free.
3. **`HandlerWrapper.from()`** — add `opts?.fieldName` to the positional constructor call.
   - Object/workflow-only fields: `opts !== undefined && "fieldName" in opts ? opts?.fieldName : undefined`
4. **`HandlerWrapper` constructor** — add `public readonly fieldName?: Type` parameter.

## Discovery options only: Wire through discovery

### `packages/libs/restate-sdk/src/endpoint/discovery.ts`

Add the field to both **`Service`** and **`Handler`** interfaces. Use wire types (`number` for millis, `boolean` for flags).

### `packages/libs/restate-sdk/src/endpoint/components.ts`

- **`commonServiceOptions()`**: `fieldName: options?.fieldName,`
- **`commonHandlerOptions()`**: `fieldName: wrapper.fieldName,`
- Durations: wrap with `millisOrDurationToMillis()` + `!== undefined` guard
- Object/workflow-only in `commonServiceOptions`: `"fieldName" in options` guard

## Runtime-only options: Wire through execution

Options that affect handler execution but not discovery (like `asTerminalError`, `serde`) just need to be read where the handler is invoked. Check how existing runtime options are consumed in `components.ts` handler classes.

## Verification

Run `npx tsc --noEmit` from `packages/libs/restate-sdk/`.