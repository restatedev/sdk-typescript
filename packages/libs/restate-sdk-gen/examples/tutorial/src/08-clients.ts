// Tier 8: calling other handlers (typed clients + awakeables).
//
// Maps to guide.md §"Calling other services". The fluent API mirrors
// the SDK's typed clients but each handler-method returns `Future<T>`
// instead of `RestatePromise<T>` so it composes with `yield*`,
// combinators, and the rest of the API uniformly.
//
//   serviceClient(api)       — typed call into a service
//   objectClient(api, key)   — typed call into a virtual object
//   workflowClient(api, key) — typed call into a workflow
//   *SendClient              — fire-and-forget; returns InvocationHandle (sync)
//
// This tier also demonstrates **awakeables**: the canonical pattern for
// cross-handler coordination. The waiter registers an awakeable, hands
// the id to a worker, and parks on `promise`. The worker calls
// `resolveAwakeable(id, value)` and the waiter resumes.

import * as restate from "@restatedev/restate-sdk";
import {
  gen,
  execute,
  awakeable,
  resolveAwakeable,
  serviceClient,
  serviceSendClient,
  objectClient,
  state,
  sharedState,
} from "@restatedev/restate-sdk-gen";
import type { counter } from "./07-state.js";

// ─── A small "echo" service to call into ───────────────────────────
//
// Stands in for "some other service in your system." `record` mutates
// a process-local sink so we can demonstrate fire-and-forget sends.

const RECORDED: { msg: string; at: number }[] = [];

export const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string): Promise<string> =>
      `hello, ${name}`,

    record: async (_ctx: restate.Context, msg: string): Promise<void> => {
      RECORDED.push({ msg, at: Date.now() });
    },

    recorded: async (_ctx: restate.Context): Promise<typeof RECORDED> =>
      RECORDED,
  },
});

// ─── Awakeable holder VO ──────────────────────────────────────────
//
// Stores a pending awakeable id under the key "id". `completeAwaiter`
// reads it back and resolves the awakeable with a payload — this is
// what unparks the awaiter on the other side. In real workflows the
// id often surfaces through an external system (webhook, queue) and
// the holder VO is just a convenient stash.

type HolderState = { id: string };

export const awakeableHolder = restate.object({
  name: "awakeableHolder",
  handlers: {
    hold: async (ctx: restate.ObjectContext, id: string): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          state<HolderState>().set("id", id);
        })
      ),

    completeAwaiter: async (
      ctx: restate.ObjectContext,
      payload: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          const id = yield* state<HolderState>().get("id");
          if (!id) {
            throw new restate.TerminalError("no awakeable registered yet");
          }
          resolveAwakeable(id, payload);
          state<HolderState>().clear("id");
        })
      ),

    pendingId: async (
      ctx: restate.ObjectSharedContext
    ): Promise<string | null> =>
      execute(
        ctx,
        gen(function* () {
          return (yield* sharedState<HolderState>().get("id")) ?? null;
        })
      ),
  },
});

// ─── The orchestrator service that uses the clients ───────────────

const Greeter: restate.ServiceDefinitionFrom<typeof greeter> = {
  name: "greeter",
};
const Counter: restate.VirtualObjectDefinitionFrom<typeof counter> = {
  name: "counter",
};
const AwakeableHolder: restate.VirtualObjectDefinitionFrom<
  typeof awakeableHolder
> = { name: "awakeableHolder" };

export const clients = restate.service({
  name: "clients",
  handlers: {
    // 8.1 typed service call.
    // `serviceClient(api).method(arg)` → `Future<T>`.
    callGreeter: async (ctx: restate.Context, name: string): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          return yield* serviceClient(Greeter).greet(name);
        })
      ),

    // 8.2 typed object call (per-key).
    // `objectClient(api, key).method(arg)` routes to the VO with that
    // key; exclusive access for the duration of that handler.
    incrementCounter: async (
      ctx: restate.Context,
      key: string
    ): Promise<{ oldValue: number; newValue: number }> =>
      execute(
        ctx,
        gen(function* () {
          return yield* objectClient(Counter, key).add(1);
        })
      ),

    // 8.3 send (fire-and-forget).
    // `*SendClient` methods are synchronous — they record a journal
    // entry and return an `InvocationHandle` (no `yield*`). Useful when
    // you don't need the result.
    fireAndForgetRecord: async (
      ctx: restate.Context,
      msg: string
    ): Promise<void> =>
      execute(
        ctx,
        gen(function* () {
          serviceSendClient(Greeter).record(msg);
        })
      ),

    // 8.4 cross-handler coordination via awakeable.
    //
    // Register an awakeable, stash its id in the holder VO, park on
    // the promise. The id is then completable by anyone who reads it
    // out (here: hit `awakeableHolder/completeAwaiter` from the
    // ingress — see ../README.md for curl steps). The waiter resumes
    // with the payload.
    awaitExternal: async (ctx: restate.Context): Promise<string> =>
      execute(
        ctx,
        gen(function* () {
          const { id, promise } = awakeable<string>();
          yield* objectClient(AwakeableHolder, "demo").hold(id);
          return yield* promise;
        })
      ),
  },
});
