---
name: add-e2e-test
description: When the user asks to add a new e2e test to the restate-e2e-services package
user-invocable: true
---

# Adding an e2e test to restate-e2e-services

All e2e test infrastructure lives under `packages/tests/restate-e2e-services/`. These tests are NOT run directly — they are executed by the Java e2e test runner which spins up Restate, deploys services, and injects `RESTATE_INGRESS_URL` and `RESTATE_ADMIN_URL` environment variables.

## Architecture

- **Services** (`src/`): Restate service definitions (the SUT). Registered via `REGISTRY` and imported in `app.ts`.
- **Tests** (`test/`): Vitest test files that call services through the ingress client.
- **Test config** (`custom_tests.yaml`): YAML config read by the Java e2e test runner to know which commands to execute.
- **Shared utils** (`test/utils.ts`): Provides `ingressClient()`, `getIngressUrl()`, `getAdminUrl()` — reads from env vars injected by the test runner.

## Steps to add a new e2e test

### 1. Create the service under test in `src/`

Create `src/<service_name>.ts` following this pattern:

```typescript
import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

const myService = restate.service({
  name: "MyService",
  handlers: {
    myHandler: async (ctx: restate.Context, input: string): Promise<string> => {
      // handler logic
      return `result: ${input}`;
    },
  },
});

REGISTRY.addService(myService);
// Use REGISTRY.addObject() for virtual objects, REGISTRY.addWorkflow() for workflows

export type MyService = typeof myService;
```

Key points:
- Always register with `REGISTRY` so the service is discoverable
- Always export the type (`export type MyService = typeof myService`) so tests can import it for typed client calls

### 2. Import the service in `src/app.ts`

Add an import line alongside the other service imports:

```typescript
import "./my_service.js";
```

### 3. Create the test file in `test/`

Create `test/<service_name>.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ingressClient } from "./utils.js";
import type { MyService } from "../src/my_service.js";

const MyService: MyService = { name: "MyService" };

describe("MyService", () => {
  it("should do something", async () => {
    const ingress = ingressClient();
    const client = ingress.serviceClient(MyService);

    const result = await client.myHandler("input");

    expect(result).toBe("result: input");
  });
});
```

Key points:
- Import the service TYPE from `../src/` for typed ingress client calls
- Create a const with `{ name: "ServiceName" }` matching the service's registered name
- Use `ingressClient()` from `./utils.js` — never hardcode URLs
- For virtual objects use `ingress.objectClient(MyObject, "key")`
- For workflows use `ingress.workflowClient(MyWorkflow, "workflowId")`

### 4. Type-check

Run from repo root:

```bash
pnpm --filter @restatedev/restate-e2e-services run _check:types
```

## Available client patterns in tests

From `@restatedev/restate-sdk-clients`:

```typescript
const ingress = ingressClient();

// Service call
const svc = ingress.serviceClient(MyService);
await svc.handler(input);

// Virtual object call
const obj = ingress.objectClient(MyObject, "key");
await obj.handler(input);

// Workflow
const wf = ingress.workflowClient(MyWorkflow, "wfId");
await wf.workflowSubmit(input);
await wf.workflowAttach();

// Send (fire and forget)
const send = ingress.serviceSendClient(MyService);
await send.handler(input);

// Idempotent call
await svc.handler(input, restate.rpc.opts({ idempotencyKey: "key" }));
```