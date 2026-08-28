/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { describe, expect, it, vi } from "vitest";
import * as restate from "../src/index.js";
import { makeRpcCallProxy, makeRpcSendProxy } from "../src/types/rpc.js";
import type { GenericCall, GenericSend } from "../src/context.js";
import { toServiceDiscovery } from "./testutils.js";

// A shared contract using a non-JSON serde on one handler.
const greeter = restate.iface.service("greeter", {
  greet: restate.iface.serdes({
    input: restate.serde.binary,
    output: restate.serde.binary,
  }),
  ping: restate.iface.json<{ name: string }, string>(),
});

const counter = restate.iface.object("counter", {
  add: restate.iface.json<number, number>(),
  get: restate.iface.shared.json<void, number>(),
});

describe("iface + implement", () => {
  it("carries the declared serdes on the interface value", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (greeter as any)._handlers;
    expect(handlers.greet._inputSerde).toBe(restate.serde.binary);
    expect(handlers.greet._outputSerde).toBe(restate.serde.binary);
    // json handlers declare no serde (JSON is the default)
    expect(handlers.ping._inputSerde).toBeUndefined();
  });

  it("produces a bindable service definition with the right content types", () => {
    const def = restate.implement(greeter, {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/require-await
        greet: async (_ctx, audio) => audio,
        // eslint-disable-next-line @typescript-eslint/require-await
        ping: async (_ctx, req) => req.name,
      },
    });

    const svc = toServiceDiscovery(def);
    const greet = svc.handlers.find((h) => h.name === "greet");
    const ping = svc.handlers.find((h) => h.name === "ping");

    expect(greet?.input?.contentType).toEqual(restate.serde.binary.contentType);
    expect(ping?.input?.contentType).toEqual(restate.serde.json.contentType);
    // the implemented definition still carries the descriptors for callers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((def as any)._handlers.greet._inputSerde).toBe(restate.serde.binary);
  });

  it("implements object exclusive vs shared handlers and binds", () => {
    const def = restate.implement(counter, {
      handlers: {
        add: async (ctx, amount) => {
          const current = (await ctx.get<number>("count")) ?? 0;
          ctx.set("count", current + amount);
          return current + amount;
        },
        // shared handlers get a read-only context
        get: async (ctx) => (await ctx.get<number>("count")) ?? 0,
      },
    });

    const svc = toServiceDiscovery(def);
    expect(svc.ty).toEqual("VIRTUAL_OBJECT");
    expect(svc.handlers.map((h) => h.name).sort()).toEqual(["add", "get"]);
    const get = svc.handlers.find((h) => h.name === "get");
    expect(get?.ty).toEqual("SHARED");
  });

  it("rejects a bare (un-implemented) interface at bind time", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => toServiceDiscovery(greeter as any)).toThrow();
  });
});

describe("client serde reuse", () => {
  it("uses the interface serdes when no call opts are provided", async () => {
    const call = vi.fn(
      (_c: GenericCall<unknown, unknown>): Promise<unknown> =>
        Promise.resolve(new Uint8Array())
    );
    const client = makeRpcCallProxy<{
      greet: (i: Uint8Array) => Promise<unknown>;
    }>(
      call,
      restate.serde.json,
      greeter.name,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (greeter as any)._handlers
    );

    await client.greet(new Uint8Array([1, 2, 3]));

    expect(call).toHaveBeenCalledOnce();
    const arg = call.mock.calls[0]![0];
    expect(arg.inputSerde).toBe(restate.serde.binary);
    expect(arg.outputSerde).toBe(restate.serde.binary);
  });

  it("lets explicit call opts override the interface serdes", async () => {
    const call = vi.fn(
      (_c: GenericCall<unknown, unknown>): Promise<unknown> =>
        Promise.resolve(new Uint8Array())
    );
    const client = makeRpcCallProxy<{
      greet: (i: Uint8Array, opts?: unknown) => Promise<unknown>;
    }>(
      call,
      restate.serde.json,
      greeter.name,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (greeter as any)._handlers
    );

    await client.greet(
      new Uint8Array(),
      restate.rpc.opts({ input: restate.serde.empty })
    );

    const arg = call.mock.calls[0]![0];
    expect(arg.inputSerde).toBe(restate.serde.empty);
    // output still comes from the interface descriptor
    expect(arg.outputSerde).toBe(restate.serde.binary);
  });

  it("falls back to the default serde when no descriptor map is present", async () => {
    const call = vi.fn(
      (_c: GenericCall<unknown, unknown>): Promise<unknown> =>
        Promise.resolve(new Uint8Array())
    );
    const client = makeRpcCallProxy<{
      greet: (i: unknown) => Promise<unknown>;
    }>(call, restate.serde.json, "greeter");

    await client.greet({});
    const arg = call.mock.calls[0]![0];
    expect(arg.inputSerde).toBe(restate.serde.json);
    expect(arg.outputSerde).toBe(restate.serde.json);
  });

  it("reuses the interface serde on the send path too", () => {
    const send = vi.fn((_s: GenericSend<unknown>) => {});
    const client = makeRpcSendProxy<{ greet: (i: Uint8Array) => void }>(
      send,
      restate.serde.json,
      greeter.name,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (greeter as any)._handlers
    );

    client.greet(new Uint8Array());
    expect(send.mock.calls[0]![0].inputSerde).toBe(restate.serde.binary);
  });
});

describe("client typing (compile-time)", () => {
  it("derives the client type from the interface", () => {
    // Never executed — this only needs to type-check.
    const _typeChecks = () => {
      const ctx = undefined as unknown as restate.Context;

      const p: PromiseLike<string> = ctx.client(greeter).ping({
        name: "a",
      });
      void p;

      // @ts-expect-error ping requires a { name: string } argument
      ctx.client(greeter).ping(123);

      // object client via the same factory (kind-dispatched, needs the key)
      const n: PromiseLike<number> = ctx.client(counter, "k").add(1);
      void n;
    };
    void _typeChecks;
    expect(true).toBe(true);
  });
});

// The runtime enrichment: plain service()/object()/workflow() values now carry
// the `_kind` + `_handlers` descriptor contract, so their serdes flow to callers
// (via serviceClient/objectClient/client) — without any change to their type.
describe("service()/object()/workflow() carry the Descriptor contract", () => {
  const svc = restate.service({
    name: "svc",
    handlers: {
      echo: restate.handlers.handler(
        { input: restate.serde.binary, output: restate.serde.binary },
        // eslint-disable-next-line @typescript-eslint/require-await
        async (_ctx: restate.Context, x: Uint8Array) => x
      ),
      // eslint-disable-next-line @typescript-eslint/require-await
      ping: async (_ctx: restate.Context, x: string) => x, // JSON default
    },
  });

  const obj = restate.object({
    name: "obj",
    handlers: {
      // eslint-disable-next-line @typescript-eslint/require-await
      add: async (_ctx: restate.ObjectContext, n: number) => n,
      get: restate.handlers.object.shared(
        // eslint-disable-next-line @typescript-eslint/require-await
        async (_ctx: restate.ObjectSharedContext) => 0
      ),
    },
  });

  it("plain service() carries _kind + _handlers with the declared serdes", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = svc as any;
    expect(d._kind).toBe("service");
    expect(d._handlers.echo._inputSerde).toBe(restate.serde.binary);
    expect(d._handlers.echo._outputSerde).toBe(restate.serde.binary);
    // JSON-default handler records no serde → caller falls back to JSON.
    expect(d._handlers.ping._inputSerde).toBeUndefined();
    // The type is unchanged: `{ name }` reconstruction still works.
    const reconstructed: typeof svc = { name: "svc" };
    expect(reconstructed.name).toBe("svc");
  });

  it("plain object() carries _kind and the shared flag per handler", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = obj as any;
    expect(d._kind).toBe("object");
    expect(d._handlers.get._shared).toBe(true);
    expect(d._handlers.add._shared).toBe(false);
  });

  it("a client built from a plain service() reuses its declared serdes", async () => {
    const call = vi.fn(
      (_c: GenericCall<unknown, unknown>): Promise<unknown> =>
        Promise.resolve(new Uint8Array())
    );
    const client = makeRpcCallProxy<{
      echo: (i: Uint8Array) => Promise<unknown>;
    }>(
      call,
      restate.serde.json,
      svc.name,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any)._handlers
    );

    await client.echo(new Uint8Array([1, 2, 3]));

    const arg = call.mock.calls[0]![0];
    expect(arg.inputSerde).toBe(restate.serde.binary);
    expect(arg.outputSerde).toBe(restate.serde.binary);
  });
});
