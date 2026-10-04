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

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { HandlerDescriptor, Serde } from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis, serde } from "@restatedev/restate-sdk-core";
import type { ActorContext, ActorKV } from "./actor.js";
import type { GenericSend, Rand, Request } from "./context.js";
import type { ContextImpl } from "./context_impl.js";
import { WasmHeader } from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import type { WasmVM } from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import { ensureError } from "./types/errors.js";
import { makeRpcSendProxy } from "./types/rpc.js";

type ClientTarget = {
  name: string;
  _handlers?: Record<string, HandlerDescriptor>;
};

/**
 * Implementation of {@link ActorContext} and {@link ActorSharedContext} on top of the VM transactional API.
 *
 * The same implementation is used for read-only handlers: in that case no transaction is started,
 * and the VM rejects writes.
 */
export class ActorContextImpl implements ActorContext<any> {
  readonly kv: ActorKV<any>;
  private closed = false;
  /** Set when a VM call failed: the attempt is over, and the error must not be committed as the handler result. */
  vmFailure?: Error;

  constructor(
    private readonly ctx: ContextImpl,
    private readonly readOnly: boolean
  ) {
    this.kv = new ActorKVImpl(this);
  }

  get key(): string {
    return this.ctx.key;
  }

  get console(): Console {
    return this.ctx.console;
  }

  get rand(): Rand {
    return this.ctx.rand;
  }

  get defaultSerde(): Serde<any> {
    return this.ctx.defaultSerde;
  }

  request(): Request {
    return this.ctx.request();
  }

  serviceSendClient(def: ClientTarget): any {
    return this.sendProxy(def);
  }

  objectSendClient(def: ClientTarget, key: string): any {
    return this.sendProxy(def, key);
  }

  workflowSendClient(def: ClientTarget, key: string): any {
    return this.sendProxy(def, key);
  }

  genericSend<REQ = Uint8Array>(send: GenericSend<REQ>): void {
    const requestSerde = send.inputSerde ?? (serde.binary as Serde<REQ>);
    const parameter = requestSerde.serialize(send.parameter);
    const delay =
      send.delay !== undefined ? millisOrDurationToMillis(send.delay) : 0;
    this.vm("send", (vm) =>
      vm.tx_send(
        send.service,
        send.method,
        parameter,
        send.key,
        send.headers
          ? Object.entries(send.headers).map(
              ([key, value]) => new WasmHeader(key, value)
            )
          : [],
        delay > 0 ? BigInt(delay) : undefined,
        send.idempotencyKey,
        send.scope,
        send.limitKey,
        send.name
      )
    );
  }

  /** Called once the handler returned: from now on the context can't be used anymore. */
  close() {
    this.closed = true;
  }

  vm<T>(op: string, f: (vm: WasmVM) => T): T {
    if (this.closed) {
      throw new Error(
        `Cannot execute '${op}' after the actor handler returned. Make sure to await all the promises in the actor handler.`
      );
    }
    if (this.readOnly && op !== "get state" && op !== "get state keys") {
      throw new Error(`Cannot execute '${op}' in a read-only actor handler.`);
    }
    try {
      return f(this.ctx.coreVm);
    } catch (e) {
      // The VM is now closed and already wrote the error out, the attempt is over.
      const error = ensureError(e);
      this.vmFailure = error;
      this.ctx.abortAttempt(error);
      throw error;
    }
  }

  private sendProxy(def: ClientTarget, key?: string): any {
    return makeRpcSendProxy(
      (send) => this.genericSend(send),
      this.defaultSerde,
      def.name,
      key,
      undefined,
      def._handlers
    );
  }
}

class ActorKVImpl implements ActorKV<any> {
  constructor(private readonly actorCtx: ActorContextImpl) {}

  get(key: string, serde?: Serde<any>): any {
    const value = this.actorCtx.vm("get state", (vm) => vm.tx_get_state(key));
    if (value === undefined) {
      return undefined;
    }
    return (serde ?? this.actorCtx.defaultSerde).deserialize(value);
  }

  has(key: string): boolean {
    return (
      this.actorCtx.vm("get state", (vm) => vm.tx_get_state(key)) !== undefined
    );
  }

  keys(prefix?: string): string[] {
    const keys = this.actorCtx.vm("get state keys", (vm) =>
      vm.tx_get_state_keys()
    );
    return prefix === undefined
      ? keys
      : keys.filter((k) => k.startsWith(prefix));
  }

  entries(prefix?: string, serde?: Serde<any>): Array<[string, any]> {
    return this.keys(prefix).map((k) => [k, this.get(k, serde)]);
  }

  set(key: string, value: any, serde?: Serde<any>): void {
    const bytes = (serde ?? this.actorCtx.defaultSerde).serialize(value);
    this.actorCtx.vm("set state", (vm) => vm.tx_set_state(key, bytes));
  }

  delete(key: string): boolean {
    const existed = this.has(key);
    if (existed) {
      this.actorCtx.vm("clear state", (vm) => vm.tx_clear_state(key));
    }
    return existed;
  }

  update(
    key: string,
    fn: (current: unknown) => unknown,
    serde?: Serde<any>
  ): unknown {
    const next = fn(this.get(key, serde));
    if (next === undefined) {
      this.delete(key);
    } else {
      this.set(key, next, serde);
    }
    return next;
  }

  clear(prefix?: string): void {
    if (prefix === undefined) {
      this.actorCtx.vm("clear all state", (vm) => vm.tx_clear_all_state());
      return;
    }
    for (const key of this.keys(prefix)) {
      this.actorCtx.vm("clear state", (vm) => vm.tx_clear_state(key));
    }
  }
}
