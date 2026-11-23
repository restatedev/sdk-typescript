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

import { toServiceDiscovery } from "./testutils.js";
import * as restate from "../src/index.js";
import { createEndpointHandler } from "../src/fetch.js";
import type * as discovery from "../src/endpoint/discovery.js";
import { describe, expect, it } from "vitest";

const greeterFoo = restate.service({
  name: "greeter",
  handlers: {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    greet(ctx: restate.Context, req: string): Promise<string> {
      return this.foo(ctx, req);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async foo(ctx: restate.Context, req: string): Promise<string> {
      return req;
    },
  },
});

describe("BindService", () => {
  it("should preserve `this`", async () => {
    // @ts-expect-error service does not exist in the returned type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    expect(await greeterFoo.service?.greet({}, "abc")).toEqual("abc");
  });
});

const inputBytes = restate.service({
  name: "acceptBytes",
  handlers: {
    greeter: restate.handlers.handler(
      {
        input: restate.serde.binary,
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_ctx: restate.Context, audio: Uint8Array) => {
        return { length: audio.length };
      }
    ),
  },
});

const inputBytesWithCustomAccept = restate.service({
  name: "acceptBytes",
  handlers: {
    greeter: restate.handlers.handler(
      {
        accept: "application/*",
        input: restate.serde.binary,
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_ctx: restate.Context, audio: Uint8Array) => {
        return { length: audio.length };
      }
    ),
  },
});

describe("AcceptBytes", () => {
  it("should declare accept content type correctly", () => {
    const svc = toServiceDiscovery(inputBytes);

    expect(svc.handlers[0]?.input?.contentType).toEqual(
      restate.serde.binary.contentType
    );
  });

  it("should declare accept content type correctly when custom accept is provided", () => {
    const svc = toServiceDiscovery(inputBytesWithCustomAccept);

    expect(svc.handlers[0]?.input?.contentType).toEqual("application/*");
  });
});

describe("PropagateConfigOptions", () => {
  it("should declare config option on a service correctly", () => {
    const svc = toServiceDiscovery(
      restate.service({
        name: "greeter",
        handlers: {
          // eslint-disable-next-line @typescript-eslint/require-await
          async greet(ctx: restate.Context, req: string): Promise<string> {
            return req;
          },
        },
        options: {
          journalRetention: { seconds: 10 },
        },
      })
    );

    expect(svc.journalRetention).toEqual(10 * 1000);
  });

  it("should declare config option on a handler correctly", () => {
    const svc = toServiceDiscovery(
      restate.service({
        name: "greeter",
        handlers: {
          greet: restate.handlers.handler(
            {
              journalRetention: { seconds: 10 },
            },
            // eslint-disable-next-line @typescript-eslint/require-await
            async (ctx: restate.Context, req: string): Promise<string> => {
              return req;
            }
          ),
        },
      })
    );

    expect(svc.journalRetention).toBeUndefined();
    expect(svc.handlers[0]?.journalRetention).toEqual(10 * 1000);
  });

  it("should apply endpoint global config option", () => {
    const svc = toServiceDiscovery(
      restate.service({
        name: "greeter",
        handlers: {
          // eslint-disable-next-line @typescript-eslint/require-await
          async greet(ctx: restate.Context, req: string): Promise<string> {
            return req;
          },
        },
      }),
      {
        journalRetention: { seconds: 10 },
      }
    );

    expect(svc.journalRetention).toEqual(10 * 1000);
    // Only service level is configured in this case, runtime deals with configuration levels
    expect(svc.handlers[0]?.journalRetention).toBeUndefined();
  });

  it("service defined journal retention should override the global config option", () => {
    const svc = toServiceDiscovery(
      restate.service({
        name: "greeter",
        handlers: {
          // eslint-disable-next-line @typescript-eslint/require-await
          async greet(ctx: restate.Context, req: string): Promise<string> {
            return req;
          },
        },
        options: {
          journalRetention: { seconds: 5 },
        },
      }),
      {
        journalRetention: { seconds: 10 },
      }
    );

    expect(svc.journalRetention).toEqual(5 * 1000);
    // Only service level is configured in this case, runtime deals with configuration levels
    expect(svc.handlers[0]?.journalRetention).toBeUndefined();
  });

  it("service defined ingress private should override the global config option", () => {
    const svc = toServiceDiscovery(
      restate.service({
        name: "greeter",
        handlers: {
          // eslint-disable-next-line @typescript-eslint/require-await
          async greet(ctx: restate.Context, req: string): Promise<string> {
            return req;
          },
        },
        options: {
          ingressPrivate: false,
        },
      }),
      {
        ingressPrivate: true,
      }
    );

    expect(svc.ingressPrivate).toEqual(false);
    // Only service level is configured in this case, runtime deals with configuration levels
    expect(svc.handlers[0]?.ingressPrivate).toBeUndefined();
  });
});

describe("Preemptable", () => {
  const MANIFEST_V5 = "application/vnd.restate.endpointmanifest.v5+json";
  const MANIFEST_V6 = "application/vnd.restate.endpointmanifest.v6+json";

  const fetchHandler = createEndpointHandler({
    services: [
      restate.service({
        name: "notPreemptable",
        handlers: {
          overridden: restate.handlers.handler(
            { preemptable: true },
            // eslint-disable-next-line @typescript-eslint/require-await
            async (_ctx: restate.Context) => {}
          ),
          // eslint-disable-next-line @typescript-eslint/require-await
          async inherited(_ctx: restate.Context) {},
        },
        options: { preemptable: false },
      }),
      restate.service({
        name: "unset",
        handlers: {
          // eslint-disable-next-line @typescript-eslint/require-await
          async greet(_ctx: restate.Context) {},
        },
      }),
    ],
  });

  async function discover(accept: string) {
    const res = await fetchHandler(
      new Request("http://localhost/discover", { headers: { accept } })
    );
    expect(res.status).toEqual(200);
    const manifest = (await res.json()) as discovery.Endpoint;
    const service = (name: string) =>
      manifest.services.find((s) => s.name === name)!;
    const handler = (svc: discovery.Service, name: string) =>
      svc.handlers.find((h) => h.name === name)!;
    return {
      contentType: res.headers.get("content-type"),
      notPreemptable: service("notPreemptable"),
      unset: service("unset"),
      handler,
    };
  }

  it("negotiates V6 and emits preemptable only when explicitly set", async () => {
    const { contentType, notPreemptable, unset, handler } = await discover(
      `${MANIFEST_V5}, ${MANIFEST_V6}`
    );

    expect(contentType).toEqual(MANIFEST_V6);
    expect(notPreemptable.preemptable).toBe(false);
    expect(handler(notPreemptable, "overridden").preemptable).toBe(true);
    expect(handler(notPreemptable, "inherited")).not.toHaveProperty(
      "preemptable"
    );
    expect(unset).not.toHaveProperty("preemptable");
    expect(handler(unset, "greet")).not.toHaveProperty("preemptable");
  });

  it("drops preemptable when V5 is negotiated", async () => {
    const { contentType, notPreemptable, handler } =
      await discover(MANIFEST_V5);

    expect(contentType).toEqual(MANIFEST_V5);
    expect(notPreemptable).not.toHaveProperty("preemptable");
    expect(handler(notPreemptable, "overridden")).not.toHaveProperty(
      "preemptable"
    );

    // Dropping the field must not alter the endpoint metadata used by later discoveries.
    const v6 = await discover(MANIFEST_V6);
    expect(v6.notPreemptable.preemptable).toBe(false);
  });
});
