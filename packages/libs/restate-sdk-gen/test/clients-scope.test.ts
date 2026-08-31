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

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, test } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import { service, object } from "../src/index.js";
import { makeClient, makeSendClient } from "../src/clients.js";
import {
  scope as ingressScope,
  client as ingressClient,
  sendClient as ingressSendClient,
  type GenIngress,
} from "../src/ingress.js";

const greeter = service({
  name: "greeter",
  handlers: {
    *greet(name: string) {
      return `hi ${name}`;
    },
  },
});

const counter = object({
  name: "counter",
  handlers: {
    *add(n: number) {
      return n;
    },
  },
});

describe("in-handler client — scope + limitKey threading", () => {
  test("makeClient with a scope stamps scope on the GenericCall", () => {
    let captured: any;
    const c: any = makeClient(
      greeter as any,
      undefined,
      (o) => {
        captured = o;
        return {} as any;
      },
      "tenant-1"
    );

    c.greet(
      "sam",
      restate.rpc.opts({ limitKey: "user42", idempotencyKey: "k" })
    );

    expect(captured.service).toBe("greeter");
    expect(captured.method).toBe("greet");
    expect(captured.scope).toBe("tenant-1");
    expect(captured.limitKey).toBe("user42");
    expect(captured.idempotencyKey).toBe("k");
  });

  test("makeClient without a scope leaves scope undefined (limitKey still flows)", () => {
    let captured: any;
    const c: any = makeClient(greeter as any, undefined, (o) => {
      captured = o;
      return {} as any;
    });

    c.greet("sam", restate.rpc.opts({ limitKey: "user42" }));

    expect(captured.scope).toBeUndefined();
    expect(captured.limitKey).toBe("user42");
  });

  test("makeClient threads the object key alongside the scope", () => {
    let captured: any;
    const c: any = makeClient(
      counter as any,
      "obj-key",
      (o) => {
        captured = o;
        return {} as any;
      },
      "tenant-1"
    );

    c.add(1);

    expect(captured.key).toBe("obj-key");
    expect(captured.scope).toBe("tenant-1");
  });

  test("makeSendClient with a scope stamps scope on the GenericSend", () => {
    let captured: any;
    const c: any = makeSendClient(
      greeter as any,
      undefined,
      (o) => {
        captured = o;
        return {} as any;
      },
      "tenant-1"
    );

    c.greet(
      "sam",
      restate.rpc.sendOpts({ limitKey: "user42", delay: { seconds: 1 } })
    );

    expect(captured.scope).toBe("tenant-1");
    expect(captured.limitKey).toBe("user42");
  });
});

// The (deprecated) ingress adapter now delegates to the regular ingress
// client's `client`/`sendClient` factory: a service forwards with no key, a
// virtual object / workflow with its key, and `scope(...)` to `ingress.scope`.
describe("ingress client — delegates to the regular ingress client", () => {
  function fakeIngress(): { ingress: GenIngress; invocations: any[] } {
    const invocations: any[] = [];
    const handlerProxy = (
      kind: "call" | "send",
      def: any,
      key: string | undefined,
      scope: string | undefined
    ) =>
      new Proxy(
        {},
        {
          get:
            (_t, handler: string) =>
            (...args: any[]) => {
              invocations.push({
                kind,
                service: def.name,
                handler,
                key,
                scope,
                args,
              });
              return Promise.resolve(undefined);
            },
        }
      );
    const scopedFor = (scope: string | undefined) => ({
      client: (def: any, key?: string) => handlerProxy("call", def, key, scope),
      sendClient: (def: any, key?: string) =>
        handlerProxy("send", def, key, scope),
    });
    const ingress = {
      ...scopedFor(undefined),
      scope: (scopeKey: string) => scopedFor(scopeKey),
    } as unknown as GenIngress;
    return { ingress, invocations };
  }

  test("client(def) forwards a service with no key", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressClient(ingress, greeter).greet("sam");

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      kind: "call",
      service: "greeter",
      handler: "greet",
      key: undefined,
      scope: undefined,
    });
  });

  test("client(def, key) forwards an object with its key", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressClient(ingress, counter, "obj-key").add(1);

    expect(invocations[0]).toMatchObject({
      kind: "call",
      service: "counter",
      handler: "add",
      key: "obj-key",
      scope: undefined,
    });
  });

  test("sendClient(def) forwards a service send", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressSendClient(ingress, greeter).greet("sam");

    expect(invocations[0]).toMatchObject({ kind: "send", scope: undefined });
  });

  test("scope(ingress, key).client(def) threads the scope", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressScope(ingress, "tenant-1").client(greeter).greet("sam");

    expect(invocations[0]).toMatchObject({
      kind: "call",
      service: "greeter",
      handler: "greet",
      scope: "tenant-1",
    });
  });

  test("scope(ingress, key).client(def, key) carries object key + scope", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressScope(ingress, "tenant-1").client(counter, "obj-key").add(1);

    expect(invocations[0]).toMatchObject({
      key: "obj-key",
      scope: "tenant-1",
    });
  });

  test("scope(ingress, key).sendClient(def) threads the scope", async () => {
    const { ingress, invocations } = fakeIngress();

    await ingressScope(ingress, "tenant-1").sendClient(greeter).greet("sam");

    expect(invocations[0]).toMatchObject({ kind: "send", scope: "tenant-1" });
  });
});
