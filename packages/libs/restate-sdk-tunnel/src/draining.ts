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

// The draining registry — graceful-drain handover ownership.
//
// When the cloud asks a connection to drain (`/_/drain-tunnel`), the
// connection is "detached": its attempt settles (so the slot dials a
// replacement) WITHOUT destroying the session, which keeps serving its
// in-flight invocations. This registry owns those detached sessions:
// each is bounded by a grace timer, removes itself when the session ends
// naturally, and is destroyed unconditionally on engine teardown — a
// fatal or close() must never leave a detached session serving (and
// pinning the process) for the rest of its grace window.

import type * as http2 from "node:http2";
import type * as net from "node:net";

interface DrainingConnection {
  session: http2.Http2Session;
  socket: net.Socket;
  timer: NodeJS.Timeout;
}

export class DrainingRegistry {
  private readonly entries = new Set<DrainingConnection>();

  /**
   * Take ownership of a detached (draining) connection: let it serve its
   * in-flight streams for up to `graceMs`, then tear it down. The entry
   * removes itself if the session ends earlier on its own.
   */
  add(session: http2.Http2Session, socket: net.Socket, graceMs: number): void {
    const entry: DrainingConnection = {
      session,
      socket,
      timer: setTimeout(() => {
        this.entries.delete(entry);
        session.destroy();
        socket.destroy();
      }, graceMs),
    };
    // unref'd: a draining session must not keep the process alive past
    // engine teardown (destroyAll covers the explicit paths).
    entry.timer.unref();
    this.entries.add(entry);
    session.on("close", () => {
      clearTimeout(entry.timer);
      this.entries.delete(entry);
      socket.destroy();
    });
  }

  /** Tear down every draining connection. Idempotent. */
  destroyAll(): void {
    for (const entry of this.entries) {
      clearTimeout(entry.timer);
      entry.session.destroy();
      entry.socket.destroy();
    }
    this.entries.clear();
  }
}
