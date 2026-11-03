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

import { describe, it, expect, vi } from "vitest";
import type { WorkflowDefinition } from "@restatedev/restate-sdk-core";
import { connect, HttpCallError } from "./ingress.js";
import { Opts } from "./api.js";

type Run = { run: (ctx: unknown, input: string) => Promise<string> };
const workflow: WorkflowDefinition<"Orders", Run> = { name: "Orders" };
const key = "order /?雪";

function requestTarget(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON string target body");
  }
  return JSON.parse(init.body) as unknown;
}

describe("scoped workflow observation", () => {
  it.each(["attach", "output"] as const)(
    "%s observes the workflow in its own scope using the server target API",
    async (op) => {
      const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
        const target = (
          typeof init?.body === "string" ? JSON.parse(init.body) : {}
        ) as { scope?: string };
        return Promise.resolve(
          new Response(JSON.stringify(target.scope ?? "unscoped"))
        );
      });
      const ingress = connect({
        url: "http://localhost:8080",
        headers: {
          authorization: "Bearer test-only",
          "Content-Type": "text/plain",
        },
        fetch,
      });
      for (const scope of ["tenant-a", "tenant-b"]) {
        const client = ingress.scope(scope).workflowClient(workflow, key);
        if (op === "attach") {
          expect(await client.workflowAttach()).toBe(scope);
        } else {
          expect(await client.workflowOutput()).toEqual({
            ready: true,
            result: scope,
          });
        }
        const [url, init] = fetch.mock.lastCall!;
        expect(url).toBe(`http://localhost:8080/restate/${op}`);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("content-type")).toBe(
          "application/json"
        );
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-only"
        );
        expect(requestTarget(init)).toEqual({
          target: "workflow",
          workflowName: "Orders",
          workflowKey: key,
          scope,
        });
      }
    }
  );

  it.each(["attach", "output"] as const)(
    "keeps legacy unscoped %s requests",
    async (op) => {
      const fetch = vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response(JSON.stringify("done")))
      );
      const client = connect({
        url: "http://localhost:8080",
        fetch,
      }).workflowClient(workflow, key);
      if (op === "attach") await client.workflowAttach();
      else await client.workflowOutput();
      const [url, init] = fetch.mock.lastCall!;
      expect(url).toBe(
        `http://localhost:8080/restate/workflow/Orders/${encodeURIComponent(key)}/${op}`
      );
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  );

  it("preserves not-ready and error responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("not ready", { status: 470 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const client = connect({ url: "http://localhost:8080", fetch })
      .scope("tenant-a")
      .workflowClient(workflow, key);
    const output = await client.workflowOutput();
    expect(output.ready).toBe(false);
    expect(() => output.result).toThrow("non ready workflow");
    await expect(client.workflowAttach()).rejects.toBeInstanceOf(HttpCallError);
  });

  it("keeps decoding options and retries the same scoped target", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValueOnce(new Response("encoded"));
    const decode = vi.fn(() =>
      Promise.resolve(new TextEncoder().encode("decoded"))
    );
    const deserialize = vi.fn((bytes: Uint8Array) =>
      new TextDecoder().decode(bytes)
    );
    const client = connect({
      url: "http://localhost:8080",
      fetch,
      journalValueCodec: { encode: (bytes) => bytes, decode },
      retry: { maxAttempts: 2, initialInterval: 0 },
    })
      .scope("tenant-a")
      .workflowClient(workflow, key);
    const result = await client.workflowAttach(
      new Opts({ output: { serialize: () => new Uint8Array(), deserialize } })
    );
    expect(result).toBe("decoded");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(deserialize).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, second] = fetch.mock.calls;
    expect(first![0]).toBe(second![0]);
    expect(first![1]?.method).toBe(second![1]?.method);
    expect(first![1]?.body).toBe(second![1]?.body);
    expect(
      new Headers(first![1]?.headers).get("x-restateclient-retry-attempt")
    ).toBe("1");
    expect(
      new Headers(second![1]?.headers).get("x-restateclient-retry-attempt")
    ).toBe("2");
    expect(requestTarget(fetch.mock.lastCall![1])).toMatchObject({
      scope: "tenant-a",
    });
  });
});
