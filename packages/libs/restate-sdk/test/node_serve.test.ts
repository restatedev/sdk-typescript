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

import { afterEach, describe, expect, it, vi } from "vitest";

// Servers created by serve(), closed after each test.
const servers = vi.hoisted(() => [] as Array<{ close(): void }>);

vi.mock("node:http2", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:http2")>();
  return {
    ...original,
    createServer: vi.fn((...args: Parameters<typeof original.createServer>) => {
      const server = original.createServer(...args);
      servers.push(server);
      return server;
    }),
  };
});

import * as http2 from "node:http2";
import * as restate from "../src/index.js";

const greeter = restate.service({
  name: "Greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => `Hello ${name}`,
  },
});

async function remoteMaxConcurrentStreams(port: number) {
  const session = http2.connect(`http://127.0.0.1:${port}`);
  try {
    const settings = await new Promise<http2.Settings>((resolve, reject) => {
      session.once("remoteSettings", resolve);
      session.once("error", reject);
    });
    return settings.maxConcurrentStreams;
  } finally {
    session.close();
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("serve() HTTP/2 settings", () => {
  it("advertises maxConcurrentStreams 8 by default", async () => {
    const port = await restate.serve({ services: [greeter], port: 0 });

    expect(await remoteMaxConcurrentStreams(port)).toBe(8);
  });

  it("applies http2Settings on top of the defaults", async () => {
    const port = await restate.serve({
      services: [greeter],
      port: 0,
      http2Settings: { maxConcurrentStreams: 100 },
    });

    expect(await remoteMaxConcurrentStreams(port)).toBe(100);
  });
});
