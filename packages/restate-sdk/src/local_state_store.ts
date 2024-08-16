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

import type {
  GetStateEntryMessage,
  GetStateKeysEntryMessage,
  StartMessage_StateEntry,
} from "./generated/proto/protocol_pb.js";
import {
  ClearAllStateEntryMessage,
  ClearStateEntryMessage,
  Empty,
  GetStateKeysEntryMessage_StateKeys,
  SetStateEntryMessage,
} from "./generated/proto/protocol_pb.js";

export class LocalStateStore {
  private state: Map<string, Uint8Array | Empty>;

  constructor(private isPartial: boolean, state: StartMessage_StateEntry[]) {
    const decoder = new TextDecoder();
    this.state = new Map<string, Uint8Array | Empty>(
      state.map(({ key, value }) => [decoder.decode(key), value])
    );
  }

  // Returns true if completed
  public tryCompleteGet(key: string, msg: GetStateEntryMessage): boolean {
    const stateEntry = this.state.get(key);
    if (stateEntry === undefined) {
      if (this.isPartial) {
        // Partial eager state, so retrieve state from the runtime
        return false;
      } else {
        // Complete eager state, so state entry is null
        msg.result = { case: "empty", value: new Empty({}) };
        return true;
      }
    }

    if (stateEntry instanceof Uint8Array) {
      msg.result = { case: "value", value: stateEntry };
    } else {
      msg.result = { case: "empty", value: new Empty({}) };
    }
    return true;
  }

  // Returns true if completed
  public tryCompletedGetStateKeys(msg: GetStateKeysEntryMessage): boolean {
    if (this.isPartial) {
      return false;
    }

    const encoder = new TextEncoder();

    msg.result = {
      case: "value",
      value: new GetStateKeysEntryMessage_StateKeys({
        keys: Array.from(this.state.keys()).map((b) => encoder.encode(b)),
      }),
    };

    return true;
  }

  public set(key: string, value: Uint8Array): SetStateEntryMessage {
    this.state.set(key, value);
    return new SetStateEntryMessage({
      key: new TextEncoder().encode(key),
      value,
    });
  }

  public clear(key: string): ClearStateEntryMessage {
    this.state.set(key, new Empty());
    return new ClearStateEntryMessage({ key: new TextEncoder().encode(key) });
  }

  // When a GetState request does not have a local entry and we have partial state,
  // then the request goes to the runtime.
  // When we get the response of the runtime, we add the state to the localStateStore.
  public add(key: string, result: Uint8Array | Empty): void {
    this.state.set(key, result);
  }

  public clearAll(): ClearAllStateEntryMessage {
    this.state.clear();
    this.isPartial = false;
    return new ClearAllStateEntryMessage();
  }
}
