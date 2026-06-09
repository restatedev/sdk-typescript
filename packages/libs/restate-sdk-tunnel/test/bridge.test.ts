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

import { describe, expect, test } from "vitest";
import * as net from "node:net";
import { once } from "node:events";
import { makePlainBridge } from "../src/bridge.js";

/** A real connected socket pair over loopback. */
async function socketPair(): Promise<{
  a: net.Socket;
  b: net.Socket;
  done: () => void;
}> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  const accepted = once(server, "connection");
  const a = net.connect(port, "127.0.0.1");
  await once(a, "connect");
  const [b] = (await accepted) as [net.Socket];
  return {
    a,
    b,
    done: () => {
      a.destroy();
      b.destroy();
      server.close();
    },
  };
}

describe("makePlainBridge", () => {
  test("exposes no TLS markers (the property http2 checks)", async () => {
    const { a, done } = await socketPair();
    const bridge = makePlainBridge(a) as unknown as Record<string, unknown>;
    // Node's http2 decides "secure session" (and then enforces ALPN h2) by
    // looking at these — the bridge's whole purpose is their absence.
    expect(bridge["alpnProtocol"]).toBeUndefined();
    expect(bridge["encrypted"]).toBeUndefined();
    done();
  });

  test("forwards bytes in both directions", async () => {
    const { a, b, done } = await socketPair();
    const bridge = makePlainBridge(a);

    bridge.write("to-wire");
    const [fromBridge] = (await once(b, "data")) as [Buffer];
    expect(fromBridge.toString()).toBe("to-wire");

    b.write("from-wire");
    const [toBridge] = (await once(bridge, "data")) as [Buffer];
    expect(toBridge.toString()).toBe("from-wire");
    done();
  });

  test("peer FIN surfaces as bridge end", async () => {
    const { a, b, done } = await socketPair();
    const bridge = makePlainBridge(a);
    bridge.resume();
    b.end();
    await once(bridge, "end");
    done();
  });

  test("underlying socket error destroys the bridge", async () => {
    const { a, b, done } = await socketPair();
    const bridge = makePlainBridge(a);
    bridge.on("error", () => {}); // observe, don't crash
    // Not events.once(): the bridge emits "error" before "close", and
    // once(emitter, "close") rejects on any interim "error".
    const closed = new Promise<void>((resolve) =>
      bridge.on("close", () => resolve())
    );
    a.destroy(new Error("boom"));
    await closed;
    expect(bridge.destroyed).toBe(true);
    b.destroy();
    done();
  });

  test("multi-megabyte transfer survives both directions intact (backpressure)", async () => {
    const { a, b, done } = await socketPair();
    const bridge = makePlainBridge(a);
    const crypto = await import("node:crypto");
    const payload = crypto.randomBytes(4 * 1024 * 1024);

    // bridge → wire
    const received: Buffer[] = [];
    let receivedLen = 0;
    const gotAll = new Promise<void>((resolve) => {
      b.on("data", (c: Buffer) => {
        received.push(c);
        receivedLen += c.length;
        if (receivedLen >= payload.length) resolve();
      });
    });
    for (let off = 0; off < payload.length; off += 64 * 1024) {
      bridge.write(payload.subarray(off, off + 64 * 1024));
    }
    await gotAll;
    expect(Buffer.concat(received).equals(payload)).toBe(true);

    // wire → bridge
    const echoed: Buffer[] = [];
    let echoedLen = 0;
    const gotEcho = new Promise<void>((resolve) => {
      bridge.on("data", (c: Buffer) => {
        echoed.push(c);
        echoedLen += c.length;
        if (echoedLen >= payload.length) resolve();
      });
    });
    for (let off = 0; off < payload.length; off += 64 * 1024) {
      b.write(payload.subarray(off, off + 64 * 1024));
    }
    await gotEcho;
    expect(Buffer.concat(echoed).equals(payload)).toBe(true);
    done();
  });

  test("ending the bridge half-closes the socket (FIN to peer)", async () => {
    const { a, b, done } = await socketPair();
    const bridge = makePlainBridge(a);
    const peerEnd = once(b, "end");
    b.resume();
    bridge.end();
    await peerEnd;
    done();
  });
});
