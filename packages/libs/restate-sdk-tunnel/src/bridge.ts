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

// The TLS → cleartext-HTTP/2 bridge.
// =============================================================================
//
// The tunnel endpoint negotiates NO ALPN ("tunnel is not normal h2"); both
// sides speak HTTP/2 with prior knowledge after the TLS handshake. Node's
// http2 server, however, refuses that shape: handing a TLSSocket to
// `http2Server.emit("connection", socket)` makes Node treat the session as a
// *secure* HTTP/2 session and enforce `socket.alpnProtocol === "h2"` — with
// no ALPN negotiated it tears the session down with ERR_HTTP2_ERROR
// ("Protocol error").
//
// The fix: don't give http2 the TLSSocket. Wrap the decrypted byte stream in
// a plain `stream.Duplex` that exposes none of the TLS markers
// (`.encrypted`, `.alpnProtocol`), and emit *that* as the connection. Node
// then runs a cleartext prior-knowledge HTTP/2 session over it — exactly the
// wire shape the tunnel wants — and skips the ALPN check entirely.
//
// The bridge forwards bytes both ways with backpressure, and propagates the
// underlying socket's end/error/close so the HTTP/2 session observes peer
// disconnects promptly (the ping watchdog in connect.ts covers the silent
// half-open case the OS never surfaces).

import { Duplex } from "node:stream";

/**
 * Wrap an established (TLS) socket in a plain Duplex so Node's http2 server
 * treats the connection as cleartext prior-knowledge HTTP/2. See the module
 * header for why this exists.
 */
export function makePlainBridge(socket: Duplex): Duplex {
  const bridge = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk: Buffer, _encoding, callback) {
      socket.write(chunk, callback);
    },
    final(callback) {
      socket.end();
      callback();
    },
    destroy(err, callback) {
      socket.destroy(err ?? undefined);
      callback(err);
    },
  });

  socket.on("data", (chunk: Buffer) => {
    if (!bridge.push(chunk)) socket.pause();
  });
  socket.on("end", () => {
    bridge.push(null);
  });
  socket.on("error", (err: Error) => {
    bridge.destroy(err);
  });
  socket.on("close", () => {
    if (!bridge.destroyed) bridge.destroy();
  });

  return bridge;
}
