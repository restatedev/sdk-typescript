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

import {
  ClearAllStateEntryMessage,
  ClearStateEntryMessage,
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  SetStateEntryMessage,
  StartMessage_StateEntry,
} from "./generated/proto/protocol";
import { Empty } from "./generated/google/protobuf/empty";
import { jsonSerialize } from "./utils/utils";

export class LocalStateStore {
  private state: Map<string, Buffer | Empty>;

  constructor(private isPartial: boolean, state: StartMessage_StateEntry[]) {
    this.state = new Map<string, Buffer | Empty>(
      state.map(({ key, value }) => [key.toString(), value])
    );
  }

  public get(key: string): GetStateEntryMessage {
    const present = this.state.has(key.toString());
    if (!present && this.isPartial) {
      // Partial eager state, so retrieve state from the runtime
      return GetStateEntryMessage.create({ key: Buffer.from(key) });
    } else if (!present) {
      // Complete eager state, so state entry is null
      return GetStateEntryMessage.create({
        key: Buffer.from(key),
        empty: Empty.create({}),
      });
    }

    const stateEntry = this.state.get(key.toString());
    if (stateEntry instanceof Buffer) {
      return GetStateEntryMessage.create({
        key: Buffer.from(key),
        value: stateEntry,
      });
    } else {
      // stateEntry is Empty
      return GetStateEntryMessage.create({
        key: Buffer.from(key),
        empty: stateEntry,
      });
    }
  }

  public getStateKeys(): GetStateKeysEntryMessage {
    if (this.isPartial) {
      return {};
    }

    return GetStateKeysEntryMessage.create({
      value: {
        keys: Array.from(this.state.keys()).map((b) => Buffer.from(b)),
      },
    });
  }

  public set<T>(key: string, value: T): SetStateEntryMessage {
    const bytes = Buffer.from(jsonSerialize(value));
    this.state.set(key, bytes);
    return SetStateEntryMessage.create({
      key: Buffer.from(key, "utf8"),
      value: bytes,
    });
  }

  public clear(key: string): ClearStateEntryMessage {
    this.state.set(key, Empty.create({}));
    return ClearStateEntryMessage.create({ key: Buffer.from(key) });
  }

  // When a GetState request does not have a local entry and we have partial state,
  // then the request goes to the runtime.
  // When we get the response of the runtime, we add the state to the localStateStore.
  public add(key: string, result: Buffer | Empty): void {
    this.state.set(key, result);
  }

  public clearAll(): ClearAllStateEntryMessage {
    this.state.clear();
    this.isPartial = false;
    return {};
  }
}
