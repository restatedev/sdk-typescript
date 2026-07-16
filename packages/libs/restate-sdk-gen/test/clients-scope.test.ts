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
import { Opts as IngressOpts } from "@restatedev/restate-sdk-clients";
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

describe("ingress client — scope threading", () => {
  function fakeIngress(): { ingress: GenIngress; calls: any[]; sends: any[] } {
    const calls: any[] = [];
    const sends: any[] = [];
    const ingress = {
      call: (opts: any) => {
        calls.push(opts);
        return Promise.resolve(undefined);
      },
      send: (opts: any) => {
        sends.push(opts);
        return Promise.resolve(undefined);
      },
    } as unknown as GenIngress;
    return { ingress, calls, sends };
  }

  test("scope(ingress, key).client(def) stamps scope on the request", async () => {
    const { ingress, calls } = fakeIngress();

    await ingressScope(ingress, "tenant-1").client(greeter).greet("sam");

    expect(calls).toHaveLength(1);
    expect(calls[0].service).toBe("greeter");
    expect(calls[0].handler).toBe("greet");
    expect(calls[0].scope).toBe("tenant-1");
  });

  test("scope(ingress, key).client(def, key) carries object key + scope", async () => {
    const { ingress, calls } = fakeIngress();

    await ingressScope(ingress, "tenant-1").client(counter, "obj-key").add(1);

    expect(calls[0].key).toBe("obj-key");
    expect(calls[0].scope).toBe("tenant-1");
  });

  test("scope(ingress, key).sendClient(def) stamps scope on the send", async () => {
    const { ingress, sends } = fakeIngress();

    await ingressScope(ingress, "tenant-1").sendClient(greeter).greet("sam");

    expect(sends[0].scope).toBe("tenant-1");
  });

  test("unscoped ingress client leaves scope undefined", async () => {
    const { ingress, calls } = fakeIngress();

    await ingressClient(ingress, greeter).greet(
      "sam",
      IngressOpts.from({ idempotencyKey: "k" })
    );

    expect(calls[0].scope).toBeUndefined();
  });

  test("unscoped ingress sendClient leaves scope undefined", async () => {
    const { ingress, sends } = fakeIngress();

    await ingressSendClient(ingress, greeter).greet("sam");

    expect(sends[0].scope).toBeUndefined();
  });
});
