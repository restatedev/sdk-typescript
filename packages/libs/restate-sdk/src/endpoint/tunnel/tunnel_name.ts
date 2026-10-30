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

// The deployment name across connections.
// =============================================================================
//
// The tunnel server keys connections by `<environment>/<name>` and
// load-balances invocations across every connection registered under that
// key, so all of this process's connections (one per tunnel server, plus
// redials) must present the SAME name. With a configured name that is
// trivial. With none, the server mints a random name per handshake — so
// without coordination a multi-homed process would end up as N different
// deployments, of which the registered URL routes to one.
//
// Hence this lease: when no name is configured, exactly one connection at a
// time handshakes without a name (the "minter"); every other connection waits
// for the minted name and requests it explicitly. If the minter's handshake
// fails, the next waiter becomes the minter. Once a name is known it is
// stable for the process lifetime (it still changes across restarts, which
// the engine warns about — persist RESTATE_TUNNEL_NAME to avoid that).

/** What a connection presents in its handshake. */
export interface TunnelNameLease {
  /** The name to request; `undefined` lets the server mint one. */
  readonly name: string | undefined;
  /** True when this connection is the one letting the server mint. */
  readonly minting: boolean;
}

export class TunnelNameCoordinator {
  private name: string | undefined;
  private minterActive = false;
  private readonly waiters: Array<(lease: TunnelNameLease) => void> = [];

  constructor(configured: string | undefined) {
    this.name = configured;
  }

  /** The name every connection presents, once known. */
  get current(): string | undefined {
    return this.name;
  }

  /** Call before answering the handshake; resolves promptly in every case. */
  acquire(): Promise<TunnelNameLease> {
    if (this.name !== undefined) {
      return Promise.resolve({ name: this.name, minting: false });
    }
    if (!this.minterActive) {
      this.minterActive = true;
      return Promise.resolve({ name: undefined, minting: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** The minter's handshake succeeded: adopt the name, release the waiters. */
  minted(name: string): void {
    this.name = name;
    this.minterActive = false;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ name, minting: false });
    }
  }

  /** The minter's handshake failed (or the connection went away): hand the role on. */
  mintFailed(): void {
    this.minterActive = false;
    if (this.name !== undefined) return;
    const next = this.waiters.shift();
    if (next !== undefined) {
      this.minterActive = true;
      next({ name: undefined, minting: true });
    }
  }
}
