"use strict"

import {
    ClearStateEntryMessage,
    GetStateEntryMessage, SetStateEntryMessage,
    StartMessage_StateEntry
} from "./generated/proto/protocol";
import {Empty} from "./generated/google/protobuf/empty";
import { jsonSerialize } from "./utils/utils";

export class LocalStateStore {
    private state: Map<string, Buffer | Empty>;

    constructor(
        readonly isPartial: boolean,
        state: StartMessage_StateEntry[]) {
        this.state = new Map<string, Buffer | Empty>(state.map(({key, value}) => [key.toString(), value]))
    }

    public get(key: string): GetStateEntryMessage {
        const present = this.state.has(key.toString());
        if (!present && this.isPartial) {
            // Partial eager state, so retrieve state from the runtime
            return GetStateEntryMessage.create({ key: Buffer.from(key) });
        } else if(!present) {
            // Complete eager state, so state entry is null
            return GetStateEntryMessage.create({ key: Buffer.from(key), empty: Empty.create({})});
        }

        const stateEntry = this.state.get(key.toString());
        if(stateEntry instanceof Buffer){
            return GetStateEntryMessage.create({ key: Buffer.from(key), value: stateEntry});
        } else {
            // stateEntry is Empty
            return GetStateEntryMessage.create({ key: Buffer.from(key), empty: stateEntry});
        }
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
        this.state.set(key, Empty.create({}))
        return ClearStateEntryMessage.create({key: Buffer.from(key)})
    }

    // When a GetState request does not have a local entry and we have partial state,
    // then the request goes to the runtime.
    // When we get the response of the runtime, we add the state to the localStateStore.
    public add(key: string, result: Buffer | Empty): void {
        this.state.set(key, result);
    }
}