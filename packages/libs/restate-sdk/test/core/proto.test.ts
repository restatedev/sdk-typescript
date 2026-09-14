/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/**
 * Tests for the hand-rolled proto3 codec that replaces `prost`, plus the
 * message framing decoder. Divergences here are silent wire-format bugs, so
 * these cover the boundaries rather than the happy path.
 */

import { describe, expect, it } from "vitest";
import {
  create,
  decodeMessage,
  encodeMessage,
  messageEquals,
  ProtoDecodeError,
  ProtoReader,
  ProtoWriter,
  WireType,
} from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  CallCommand,
  CompletePromiseCommand,
  FailureDesc,
  GetLazyStateCommand,
  GetPromiseCommand,
  MessageType,
  SetStateCommand,
  SleepCommand,
  StartMessageDesc,
  ValueDesc,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { Decoder } from "../../src/endpoint/handlers/vm/ts/encoding.js";
import { DecodingError } from "../../src/endpoint/handlers/vm/ts/errors.js";
import { b, msg, str } from "./testutils.js";

describe("proto codec", () => {
  describe("varints", () => {
    it.each([
      0n,
      1n,
      127n,
      128n,
      300n,
      0xffffffffn,
      0x100000000n,
      (1n << 63n) - 1n,
      1n << 63n,
      (1n << 64n) - 1n,
    ])("round trips %s as a 64-bit varint", (v) => {
      const w = new ProtoWriter();
      w.writeVarint64(v);
      expect(new ProtoReader(w.finish()).readVarint64()).toBe(v);
    });

    it.each([0, 1, 127, 128, 300, 0x7fffffff, 0xffffffff])(
      "round trips %i as a 32-bit varint",
      (v) => {
        const w = new ProtoWriter();
        w.writeVarint32(v);
        expect(new ProtoReader(w.finish()).readVarint32()).toBe(v);
      }
    );

    it("round trips a u64 field through a message", () => {
      const m = create(SleepCommand.desc, {
        wake_up_time: (1n << 64n) - 1n,
        result_completion_id: 7,
      });
      const back = decodeMessage(
        SleepCommand.desc,
        encodeMessage(SleepCommand.desc, m)
      );
      expect(back.wake_up_time).toBe((1n << 64n) - 1n);
      expect(back.result_completion_id).toBe(7);
    });

    it("rejects a varint that never terminates", () => {
      const r = new ProtoReader(new Uint8Array(Array(11).fill(0x80)));
      expect(() => r.readVarint64()).toThrow(ProtoDecodeError);
    });
  });

  describe("proto3 presence", () => {
    it("omits non-presence scalars at their default", () => {
      // key is empty bytes and result_completion_id is 0: neither is on the wire
      const bytes = encodeMessage(
        GetLazyStateCommand.desc,
        create(GetLazyStateCommand.desc, {})
      );
      expect(bytes.length).toBe(0);
    });

    it("encodes an `optional` scalar that equals its default", () => {
      // CallCommandMessage.scope is `optional string`: an empty scope must stay
      // distinguishable from an absent one.
      const withEmpty = encodeMessage(
        CallCommand.desc,
        create(CallCommand.desc, { scope: "" })
      );
      const withNone = encodeMessage(
        CallCommand.desc,
        create(CallCommand.desc, {})
      );
      expect(withEmpty.length).toBeGreaterThan(withNone.length);
      expect(decodeMessage(CallCommand.desc, withEmpty).scope).toBe("");
      expect(decodeMessage(CallCommand.desc, withNone).scope).toBeUndefined();
    });

    it("keeps an empty message field distinguishable from an absent one", () => {
      const withEmpty = create(SetStateCommand.desc, {
        key: b("k"),
        value: { content: new Uint8Array(0) },
      });
      const back = decodeMessage(
        SetStateCommand.desc,
        encodeMessage(SetStateCommand.desc, withEmpty)
      );
      expect(back.value).toEqual({ content: new Uint8Array(0) });
      expect(
        decodeMessage(
          SetStateCommand.desc,
          encodeMessage(
            SetStateCommand.desc,
            create(SetStateCommand.desc, { key: b("k") })
          )
        ).value
      ).toBeUndefined();
    });
  });

  describe("oneof", () => {
    it("takes the last member on the wire and clears the others", () => {
      // The two members of CompletePromiseCommandMessage's `completion` oneof.
      const w = new ProtoWriter();
      w.writeLengthDelimited(
        2,
        encodeMessage(ValueDesc, { content: b("first") })
      );
      w.writeLengthDelimited(
        3,
        encodeMessage(FailureDesc, {
          code: 500,
          message: "boom",
          metadata: [],
        })
      );
      const decoded = decodeMessage(CompletePromiseCommand.desc, w.finish());
      expect(decoded.completion_value).toBeUndefined();
      expect(decoded.completion_failure).toEqual({
        code: 500,
        message: "boom",
        metadata: [],
      });
    });
  });

  describe("repeated fields", () => {
    it("accepts a packed repeated scalar", () => {
      // Future.waiting_completions is `repeated uint32`, written packed
      const inner = new ProtoWriter();
      inner.writeVarint32(1);
      inner.writeVarint32(2);
      inner.writeVarint32(300);
      const w = new ProtoWriter();
      w.writeLengthDelimited(1, inner.finish());
      const d = decodeMessage(
        {
          name: "F",
          fields: [{ no: 1, name: "xs", kind: "uint32", repeated: true }],
        },
        w.finish()
      );
      expect(d.xs).toEqual([1, 2, 300]);
    });

    it("accepts an unpacked repeated scalar", () => {
      const w = new ProtoWriter();
      w.writeUint32Field(1, 1);
      w.writeUint32Field(1, 2);
      w.writeUint32Field(1, 300);
      const d = decodeMessage(
        {
          name: "F",
          fields: [{ no: 1, name: "xs", kind: "uint32", repeated: true }],
        },
        w.finish()
      );
      expect(d.xs).toEqual([1, 2, 300]);
    });
  });

  describe("unknown fields", () => {
    it("skips unknown varint, length-delimited, fixed32 and fixed64 fields", () => {
      const w = new ProtoWriter();
      w.writeUint32Field(99, 7); // unknown varint
      w.writeLengthDelimited(98, b("ignored")); // unknown bytes
      w.writeTag(97, WireType.Fixed32);
      w.writeRaw(new Uint8Array(4));
      w.writeTag(96, WireType.Fixed64);
      w.writeRaw(new Uint8Array(8));
      w.writeLengthDelimited(1, b("real-key")); // GetLazyState.key
      const d = decodeMessage(GetLazyStateCommand.desc, w.finish());
      expect(str(d.key)).toBe("real-key");
    });
  });

  describe("strings and bytes", () => {
    it("rejects invalid UTF-8 in a string field", () => {
      const w = new ProtoWriter();
      w.writeLengthDelimited(1, new Uint8Array([0xff, 0xfe])); // GetPromise.key is a string
      expect(() => decodeMessage(GetPromiseCommand.desc, w.finish())).toThrow();
    });

    it("copies bytes fields out of a Node Buffer input", () => {
      // notify_input hands the decoder Node Buffers. Buffer.prototype.slice
      // returns a VIEW, so a decoded payload must not alias the socket buffer.
      const payload = Buffer.from([0x0a, 0x03, 0x61, 0x62, 0x63]); // key = "abc"
      const d = decodeMessage(GetLazyStateCommand.desc, payload);
      expect(str(d.key)).toBe("abc");
      payload[2] = 0x7a; // mutate the "socket buffer"
      expect(str(d.key)).toBe("abc");
    });
  });

  describe("merging", () => {
    it("merges a repeated occurrence of a non-repeated message field", () => {
      // prost merges rather than replaces. Two `value` submessages, the second
      // empty, must leave the content from the first in place.
      const valueDesc = {
        name: "Value",
        fields: [{ no: 1, name: "content", kind: "bytes" as const }],
      };
      const w = new ProtoWriter();
      w.writeLengthDelimited(1, b("k")); // key
      w.writeLengthDelimited(
        3,
        encodeMessage(valueDesc, { content: b("hello") })
      );
      w.writeLengthDelimited(
        3,
        encodeMessage(valueDesc, { content: new Uint8Array(0) })
      );
      const d = decodeMessage(SetStateCommand.desc, w.finish());
      expect(str(d.value!.content)).toBe("hello");
    });
  });

  describe("structural equality", () => {
    it("compares bytes by value, not identity", () => {
      const a = create(GetLazyStateCommand.desc, {
        key: b("k"),
        result_completion_id: 1,
      });
      const c = create(GetLazyStateCommand.desc, {
        key: b("k"),
        result_completion_id: 1,
      });
      expect(messageEquals(GetLazyStateCommand.desc, a, c)).toBe(true);
      c.key = b("j");
      expect(messageEquals(GetLazyStateCommand.desc, a, c)).toBe(false);
    });

    it("distinguishes an absent optional from its default", () => {
      const a = create(CallCommand.desc, { scope: "" });
      const c = create(CallCommand.desc, {});
      expect(messageEquals(CallCommand.desc, a, c)).toBe(false);
    });
  });
});

describe("message framing decoder", () => {
  it("reassembles a message split across chunks", () => {
    const full = msg(
      MessageType.GetLazyStateCommand,
      GetLazyStateCommand.desc,
      {
        key: b("STATE"),
        result_completion_id: 1,
      }
    ).bytes;
    for (const split of [1, 4, 8, 10, full.length - 1]) {
      const d = new Decoder();
      d.push(full.subarray(0, split));
      expect(d.consumeNext(), `split at ${split}`).toBeUndefined();
      d.push(full.subarray(split));
      const m = d.consumeNext();
      expect(m, `split at ${split}`).toBeDefined();
      expect(str(m!.decodeTo(GetLazyStateCommand, 0).key)).toBe("STATE");
    }
  });

  it("copies the payload out of a Node Buffer chunk", () => {
    const full = Buffer.from(
      msg(MessageType.GetLazyStateCommand, GetLazyStateCommand.desc, {
        key: b("STATE"),
        result_completion_id: 1,
      }).bytes
    );
    const d = new Decoder();
    d.push(full);
    const m = d.consumeNext()!;
    full.fill(0);
    expect(str(m.decodeTo(GetLazyStateCommand, 0).key)).toBe("STATE");
  });

  it("consumes the header of an unknown message type so it can keep going", () => {
    const bogus = new Uint8Array(8);
    new DataView(bogus.buffer).setUint32(0, 0x0123 * 0x10000, false); // unknown type, length 0
    const good = msg(
      MessageType.GetLazyStateCommand,
      GetLazyStateCommand.desc,
      {
        key: b("STATE"),
        result_completion_id: 1,
      }
    ).bytes;

    const d = new Decoder();
    d.push(bogus);
    d.push(good);
    expect(() => d.consumeNext()).toThrow(DecodingError);
    // The bogus header must have been consumed: the next message still decodes.
    const m = d.consumeNext();
    expect(m).toBeDefined();
    expect(str(m!.decodeTo(GetLazyStateCommand, 0).key)).toBe("STATE");
  });

  it("reports a type mismatch against the expected command", () => {
    const m = new Decoder();
    m.push(msg(MessageType.SleepCommand, SleepCommand.desc, {}).bytes);
    const raw = m.consumeNext()!;
    expect(() => raw.decodeTo(GetLazyStateCommand, 3)).toThrow(DecodingError);
  });

  it("decodes StartMessage state entries", () => {
    const m = new Decoder();
    m.push(
      msg(MessageType.Start, StartMessageDesc, {
        id: b("abc"),
        debug_id: "abc",
        known_entries: 2,
        state_map: [{ key: b("k1"), value: b("v1") }],
        partial_state: false,
      }).bytes
    );
    const start = m
      .consumeNext()!
      .decodeTo({ ty: MessageType.Start, desc: StartMessageDesc }, 0);
    expect(start.state_map).toHaveLength(1);
    expect(str(start.state_map[0]!.key)).toBe("k1");
    expect(str(start.state_map[0]!.value)).toBe("v1");
    expect(start.partial_state).toBe(false);
  });
});
