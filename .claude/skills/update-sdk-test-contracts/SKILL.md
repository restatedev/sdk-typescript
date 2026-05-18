---
name: update-sdk-test-contracts
description: Update the SDK test service implementations to match a new version of the e2e conformance contracts. Use when the user says "update sdk tests", "update test contracts", or gives a specific e2e release tag to update to.
user-invocable: true
---

# Updating SDK Test Service Implementations to a New Contract Version

The conformance test suite (`restatedev/e2e`) defines contracts that every SDK must implement. When the contracts change, both service implementations in this repo must be updated.

## Step 1: Read the release notes

The user will provide a release tag (e.g. `v1.2.3`). Fetch the GitHub release to understand what changed:

```bash
gh release view v1.2.3 --repo restatedev/e2e
```

Read the release body carefully — it describes which contract interfaces changed, what new commands/handlers were added, and what was removed. This tells you exactly what to implement.

## Step 2: Identify the two service implementations to update

Both live in this repo:

| Implementation | Path | SDK |
|---------------|------|-----|
| Main e2e services | `packages/tests/restate-e2e-services/src/` | `@restatedev/restate-sdk` (async/await) |
| Gen test services | `packages/libs/restate-sdk-gen/test-services/src/` | `@restatedev/restate-sdk-gen` (generator functions) |

The key files are:
- `virtual_object_command_interpreter.ts` / `vo-command-interpreter.ts` — implements `VirtualObjectCommandInterpreter`
- `test_utils.ts` / `test-utils.ts` — implements `TestUtilsService`

Other services (awakeable-holder, failing, counter, etc.) rarely change.

## Step 3: Understand the contract types

The contracts (Kotlin interfaces) in `restatedev/e2e` define:
- **Serialized type names**: every command/handler is identified by its `@SerialName("camelCase")` string, which becomes the `type` discriminator in JSON
- **Field names**: Kotlin `camelCase` fields map directly to JSON — match them exactly
- **Return value conventions** for `VirtualObjectCommandInterpreter`:
  - `AwaitOne` / `AwaitAny` / `AwaitFirstCompleted` / `AwaitFirstSucceededOrAllFailed` → return the resolved string value; Sleep returns `"sleep"`
  - `AwaitAllSucceededOrFirstFailed` → pipe-joined values: `"val0|val1|val2"`; throws on first failure
  - `AwaitAllCompleted` → pipe-joined settled results: `"ok:val0|err:reason|ok:val2"`

## Step 4: Update the main e2e services (`packages/tests/restate-e2e-services/src/`)

These use the standard `async/await` Restate SDK. Patterns:

**New `AwaitableCommand` sub-type** (e.g. `createSignal`):
```typescript
// Add to the SubCommand union type and parseAwaitableCommand switch:
case "createSignal": {
  const ctxInternal = ctx as unknown as restate.internal.ContextInternal;
  return ctxInternal.signal<string>(command.signalName);  // returns RestatePromise<string>
}
```

**New `Command` combinator** (e.g. `awaitAllCompleted`):
```typescript
// Add to the Command union type and interpretCommands switch:
case "awaitAllCompleted": {
  const settled = await RestatePromise.allSettled(
    command.commands.map((cmd) => parseAwaitableCommand(ctx, cmd))
  );
  lastResult = settled
    .map((r) => r.status === "fulfilled" ? `ok:${r.value}` : `err:${(r.reason as Error).message}`)
    .join("|");
  break;
}
```

**New `TestUtilsService` handler** (e.g. `resolveSignal`):
```typescript
resolveSignal(
  ctx: restate.Context,
  req: { invocationId: string; signalName: string; value: string }
): Promise<void> {
  const ctxInternal = ctx as unknown as restate.internal.ContextInternal;
  ctxInternal
    .invocation(restate.InvocationIdParser.fromString(req.invocationId))
    .signal(req.signalName)
    .resolve(req.value);
  return Promise.resolve();
},
```

**Signals** use the internal `ContextInternal` API — always cast with `as unknown as restate.internal.ContextInternal` (double cast required; direct cast from `ObjectContext` is rejected by tsc).

## Step 5: Update the gen test services (`packages/libs/restate-sdk-gen/test-services/src/`)

These use generator functions. The gen SDK exports: `all`, `allSettled`, `any`, `race`, `signal`, `invocation`, `sleep`, `run`, `awakeable`, `select`, `state`, `sharedState`.

**New `AwaitableCommand` sub-type** (e.g. `createSignal`):
```typescript
case "createSignal":
  return { kind: "awakeable", future: signal<string>(cmd.signalName) };
```

**New `Command` combinator** (e.g. `awaitAllCompleted`):
```typescript
case "awaitAllCompleted": {
  const subs: SubEntry[] = [];
  for (const c of cmd.commands) subs.push(yield* createSub(c));
  const settled = (yield* allSettled(subs.map((s) => s.future))) as FutureSettledResult<unknown>[];
  result = settled
    .map((r, i) =>
      r.status === "rejected"
        ? `err:${(r.reason as Error).message}`
        : `ok:${valueToString(r.value, subs[i]!.kind)}`
    )
    .join("|");
  break;
}
```

**IMPORTANT — do NOT use `spawn` for multi-future combinators**: `spawn` creates a structured child fiber, and the parent handler waits for ALL spawned children before completing. For `race`/`any`, this means a pending signal fiber would prevent the handler from ever returning. Pass the futures directly to `all`/`allSettled`/`any`/`race`.

**New `TestUtilsService` handler** (e.g. `resolveSignal`):
```typescript
*resolveSignal(req: { invocationId: string; signalName: string; value: string }) {
  invocation(req.invocationId).signal(req.signalName).resolve(req.value);
},
```

## Step 6: Build and verify

```bash
# Type-check both packages
pnpm --filter restate-e2e-services run _check:types
pnpm --filter restate-sdk-gen build

# Build Docker images (from repo root)
podman build -t e2e-ts:local -f packages/tests/restate-e2e-services/Dockerfile .
podman build -t e2e-ts-gen:local -f packages/libs/restate-sdk-gen/test-services/Dockerfile .

# Run the affected test classes against both images (from ../e2e)
cd ../e2e
./gradlew :sdk-tests:run --args='run --sequential --image-pull-policy=CACHED --test-suite=default --test-name=<TestClass> --service-container-image=localhost/e2e-ts:local'
./gradlew :sdk-tests:run --args='run --sequential --image-pull-policy=CACHED --test-suite=default --test-name=<TestClass> --service-container-image=localhost/e2e-ts-gen:local'
```

All tests must pass on both images before the update is complete.
