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

/* eslint-disable @typescript-eslint/require-await */

import { toServiceDiscovery } from "./testutils.js";
import * as restate from "../src/index.js";
import { HandlerWrapper } from "../src/types/rpc.js";
import { describe, expect, it } from "vitest";

const counter = restate.actor({
  name: "counter",
  handlers: {
    add: async (ctx: restate.ActorContext, amount: number) => {
      return ctx.kv.update<number>("count", (c) => (c ?? 0) + amount);
    },
    get: restate.handlers.actor.shared(
      async (ctx: restate.ActorSharedContext) => ctx.kv.get<number>("count")
    ),
    reset: restate.handlers.actor.exclusive(
      { ingressPrivate: true },
      async (ctx: restate.ActorContext) => {
        ctx.kv.clear();
      }
    ),
    // Journaled handlers can be mixed in
    journaled: restate.handlers.object.exclusive(
      async (ctx: restate.ObjectContext) => {
        await ctx.sleep(10);
      }
    ),
  },
});

function isActorHandler(handler: unknown): boolean | undefined {
  return HandlerWrapper.fromHandler(handler)?.actor;
}

describe("Actor", () => {
  it("is discovered as a virtual object", () => {
    const svc = toServiceDiscovery(counter);

    expect(svc.ty).toEqual("VIRTUAL_OBJECT");
    expect(Object.fromEntries(svc.handlers.map((h) => [h.name, h.ty]))).toEqual(
      {
        add: "EXCLUSIVE",
        get: "SHARED",
        reset: "EXCLUSIVE",
        journaled: "EXCLUSIVE",
      }
    );
    expect(svc.handlers.find((h) => h.name === "reset")?.ingressPrivate).toBe(
      true
    );
  });

  it("marks handlers as actor handlers by default", () => {
    const handlers = (counter as unknown as { object: Record<string, unknown> })
      .object;

    expect(isActorHandler(handlers["add"])).toBe(true);
    expect(isActorHandler(handlers["get"])).toBe(true);
    expect(isActorHandler(handlers["reset"])).toBe(true);
    expect(isActorHandler(handlers["journaled"])).toBe(false);
  });

  it("can be used in a regular virtual object", () => {
    const obj = restate.object({
      name: "obj",
      handlers: {
        tx: restate.handlers.actor.exclusive(
          async (ctx: restate.ActorContext) => {
            ctx.kv.set("a", 1);
          }
        ),
      },
    });

    expect(toServiceDiscovery(obj).handlers[0]?.ty).toEqual("EXCLUSIVE");
  });

  it("is rejected in services", () => {
    const svc = restate.service({
      name: "svc",
      handlers: {
        tx: restate.handlers.actor.exclusive(
          async (ctx: restate.ActorContext) => {
            ctx.kv.set("a", 1);
          }
        ),
      },
    });

    expect(() => toServiceDiscovery(svc)).toThrow(/actor handler/);
  });

  it("is rejected in objects with lazy state", () => {
    const obj = restate.object({
      name: "obj",
      options: { enableLazyState: true },
      handlers: {
        tx: restate.handlers.actor.exclusive(
          async (ctx: restate.ActorContext) => {
            ctx.kv.set("a", 1);
          }
        ),
      },
    });

    expect(() => toServiceDiscovery(obj)).toThrow(/lazy state/);
  });
});

describe("Storage journal mode", () => {
  it("can be enabled on regular handlers", () => {
    const obj = restate.object({
      name: "obj",
      handlers: {
        order: restate.handlers.object.exclusive(
          { journal: "storage" },
          async (ctx: restate.ObjectContext) => {
            await ctx.transaction("reserve", (tx) => tx.kv.set("a", 1));
          }
        ),
      },
    });

    expect(toServiceDiscovery(obj).handlers[0]?.ty).toEqual("EXCLUSIVE");
  });

  it("is rejected on actor handlers", () => {
    const a = restate.actor({
      name: "a",
      options: { journal: "storage" },
      handlers: {
        tx: async (ctx: restate.ActorContext) => {
          ctx.kv.set("a", 1);
        },
      },
    });

    expect(() => toServiceDiscovery(a)).toThrow(/storage journal mode/);
  });
});
