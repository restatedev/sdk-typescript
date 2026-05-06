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

import type * as restate from "@restatedev/restate-sdk";
import type { Future } from "./future.js";
import { getCurrent } from "./current.js";
import type { RestateOperations } from "./restate-operations.js";

/** Synchronous handle for resolving or rejecting a signal on a target invocation */
export interface SignalReference<T> {
  resolve(payload?: T): void;
  reject(reason: string | restate.TerminalError): void;
}

/**
 * A typed reference to a running invocation. Returned by `sendClient()` methods
 * (wrapped in `Future<InvocationReference<O>>`), or created via `invocation(id)`.
 *
 * - `attach()` returns a `Future<O>` with the serde from the original descriptor.
 * - `signal()` sends a named signal to the target invocation.
 * - `cancel()` cancels the target invocation.
 */
export interface InvocationReference<O = unknown> {
  readonly invocationId: string;
  attach(serde?: restate.Serde<O>): Future<O>;
  signal<T = unknown>(
    name: string,
    serde?: restate.Serde<T>
  ): SignalReference<T>;
  cancel(): void;
}

export class InvocationReferenceImpl<
  O = unknown,
> implements InvocationReference<O> {
  constructor(
    readonly invocationId: string,
    private readonly _outputSerde?: restate.Serde<O>
  ) {}

  attach(serde?: restate.Serde<O>): Future<O> {
    return (getCurrent() as RestateOperations).attach<O>(
      this.invocationId as restate.InvocationId,
      serde ?? this._outputSerde
    );
  }

  signal<T = unknown>(
    name: string,
    serde?: restate.Serde<T>
  ): SignalReference<T> {
    return (getCurrent() as RestateOperations).invocationSignal<T>(
      this.invocationId as restate.InvocationId,
      name,
      serde
    );
  }

  cancel(): void {
    (getCurrent() as RestateOperations).cancel(
      this.invocationId as restate.InvocationId
    );
  }
}
