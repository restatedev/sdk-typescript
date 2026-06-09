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
import {
  createAuthorityShim,
  definitelyLacksAuthority,
} from "../src/h2shim.js";

const MAGIC = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");

/** :method GET, :scheme http, :path literal — the live peer's control shape. */
function controlBlock(path: string): Buffer {
  const p = Buffer.from(path);
  return Buffer.concat([Buffer.from([0x82, 0x86, 0x04, p.length]), p]);
}

function headersFrame(
  streamId: number,
  block: Buffer,
  flags = 0x04 // END_HEADERS
): Buffer {
  return Buffer.concat([
    Buffer.from([
      (block.length >> 16) & 0xff,
      (block.length >> 8) & 0xff,
      block.length & 0xff,
      0x01,
      flags,
      (streamId >> 24) & 0x7f,
      (streamId >> 16) & 0xff,
      (streamId >> 8) & 0xff,
      streamId & 0xff,
    ]),
    block,
  ]);
}

function settingsFrame(): Buffer {
  return Buffer.from([0, 0, 0, 0x04, 0, 0, 0, 0, 0]);
}

const AUTHORITY_TAIL = Buffer.from([
  0x01, 0x06, 0x74, 0x75, 0x6e, 0x6e, 0x65, 0x6c,
]);

describe("definitelyLacksAuthority", () => {
  test("the live control-request shape lacks authority", () => {
    expect(definitelyLacksAuthority(controlBlock("/_/start-tunnel"))).toBe(
      true
    );
  });

  test("a literal :authority (indexed name 1) counts as present", () => {
    const v = Buffer.from("example");
    const block = Buffer.concat([
      controlBlock("/x"),
      Buffer.from([0x01, v.length]),
      v,
    ]);
    expect(definitelyLacksAuthority(block)).toBe(false);
  });

  test("a literal host header counts as present", () => {
    const name = Buffer.from("host");
    const value = Buffer.from("example");
    const block = Buffer.concat([
      controlBlock("/x"),
      Buffer.from([0x00, name.length]),
      name,
      Buffer.from([value.length]),
      value,
    ]);
    expect(definitelyLacksAuthority(block)).toBe(false);
  });

  test("dynamic-table references are conservatively 'unknown'", () => {
    // Indexed field with index 62 (first dynamic entry).
    const block = Buffer.concat([controlBlock("/x"), Buffer.from([0xbe])]);
    expect(definitelyLacksAuthority(block)).toBe(false);
  });

  test("huffman-coded literal names are conservatively 'unknown'", () => {
    // Literal w/o indexing, literal name with huffman bit set.
    const block = Buffer.concat([Buffer.from([0x00, 0x81, 0xff, 0x01, 0x61])]);
    expect(definitelyLacksAuthority(block)).toBe(false);
  });

  test("truncated blocks are conservatively 'unknown'", () => {
    expect(definitelyLacksAuthority(Buffer.from([0x04, 0xff]))).toBe(false);
  });
});

describe("createAuthorityShim", () => {
  test("appends :authority to an authority-less stream-opening HEADERS", () => {
    const shim = createAuthorityShim();
    const block = controlBlock("/_/start-tunnel");
    const input = Buffer.concat([
      MAGIC,
      settingsFrame(),
      headersFrame(1, block),
    ]);
    const out = shim(input);
    // Magic + settings untouched.
    expect(out.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    // The HEADERS frame grew by the authority field.
    const frame = out.subarray(MAGIC.length + 9);
    const newLen = (frame[0]! << 16) | (frame[1]! << 8) | frame[2]!;
    expect(newLen).toBe(block.length + AUTHORITY_TAIL.length);
    expect(frame.subarray(frame.length - 8).equals(AUTHORITY_TAIL)).toBe(true);
  });

  test("leaves a HEADERS with authority untouched", () => {
    const shim = createAuthorityShim();
    shim(MAGIC);
    const v = Buffer.from("example");
    const block = Buffer.concat([
      controlBlock("/x"),
      Buffer.from([0x01, v.length]),
      v,
    ]);
    const frame = headersFrame(1, block);
    expect(shim(frame).equals(frame)).toBe(true);
  });

  test("leaves trailers (HEADERS on a seen stream) untouched", () => {
    const shim = createAuthorityShim();
    shim(Buffer.concat([MAGIC, headersFrame(1, controlBlock("/a"))]));
    // Trailers on stream 1: a block that would look authority-less.
    const trailerName = Buffer.from("tunnel-status");
    const trailerValue = Buffer.from("ok");
    const trailers = Buffer.concat([
      Buffer.from([0x00, trailerName.length]),
      trailerName,
      Buffer.from([trailerValue.length]),
      trailerValue,
    ]);
    const frame = headersFrame(1, trailers, 0x04 | 0x01); // END_HEADERS|END_STREAM
    expect(shim(frame).equals(frame)).toBe(true);
  });

  test("handles frames split across arbitrary chunk boundaries", () => {
    const block = controlBlock("/_/drain-tunnel");
    const input = Buffer.concat([
      MAGIC,
      settingsFrame(),
      headersFrame(3, block),
    ]);
    // Reference output in one shot:
    const reference = createAuthorityShim()(input);
    // Now byte-by-byte:
    const shim = createAuthorityShim();
    const pieces: Buffer[] = [];
    for (const byte of input) pieces.push(shim(Buffer.from([byte])));
    expect(Buffer.concat(pieces).equals(reference)).toBe(true);
  });

  test("passes large/padded/continuation frames through verbatim", () => {
    const shim = createAuthorityShim();
    shim(MAGIC);
    const padded = headersFrame(1, controlBlock("/x"), 0x04 | 0x08); // PADDED
    expect(shim(padded).equals(padded)).toBe(true);
    const noEnd = headersFrame(3, controlBlock("/y"), 0x00); // no END_HEADERS
    expect(shim(noEnd).equals(noEnd)).toBe(true);
    // DATA frame payload must never be parsed as frames.
    const data = Buffer.concat([
      Buffer.from([0, 0, 4, 0x00, 0, 0, 0, 0, 3]),
      Buffer.from([0x82, 0x86, 0x04, 0x01]), // frame-header-ish bytes inside DATA
    ]);
    expect(shim(data).equals(data)).toBe(true);
  });
});
