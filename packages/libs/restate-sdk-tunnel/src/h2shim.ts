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

// The :authority shim — wire-level compatibility with the tunnel server.
// =============================================================================
//
// The tunnel server's control requests (`GET /_/start-tunnel`,
// `/_/drain-tunnel`) are built from an origin-form URI and carry NO
// `:authority` and no `host` header (verified by wire capture against the
// live endpoint). That is legal per RFC 9113 §8.3.1 — but Node's HTTP/2
// server is backed by nghttp2, whose HTTP-messaging enforcement requires
// authority-or-host on non-CONNECT requests and RSTs the stream with
// PROTOCOL_ERROR *below* the JS layer, with no exposed opt-out. Forwarded
// invocations are unaffected (the cloud proxy preserves the original
// request's authority); only the tiny control requests trip it.
//
// The fix: a one-way transform over the INBOUND byte stream (server → us)
// that appends an `:authority` field to the HPACK block of stream-OPENING
// HEADERS frames which PROVABLY lack one. Properties that make this safe:
//
//   - The appended encoding is "literal without indexing, name = static
//     index 1 (:authority)" — it does not touch the HPACK dynamic table,
//     so the peer's encoder state stays perfectly in sync.
//   - Pseudo-headers must precede regular fields; the control requests'
//     blocks contain ONLY pseudo-headers, so appending another pseudo-
//     header keeps the block well-formed.
//   - The presence scan is STATELESS and CONSERVATIVE: any construct that
//     could hide an authority (dynamic-table references, huffman-coded
//     field names, padding, continuations) makes the scanner answer
//     "unknown" and the frame passes through untouched. A false negative
//     merely reproduces today's behavior for that stream.
//   - Trailers are HEADERS frames on already-seen stream ids and are never
//     touched (client-initiated stream ids are strictly increasing).

const FRAME_HEADER_LEN = 9;
const TYPE_HEADERS = 0x01;
const FLAG_END_HEADERS = 0x04;
const FLAG_PADDED = 0x08;
const FLAG_PRIORITY = 0x20;
const CLIENT_MAGIC_LEN = 24; // "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"
/** Only blocks this small are inspected — control requests are ~20 bytes. */
const MAX_PATCHABLE_PAYLOAD = 8 * 1024;

/** `:authority: tunnel` — literal without indexing, name = static index 1. */
const AUTHORITY_FIELD = Buffer.from([
  0x01, 0x06, 0x74, 0x75, 0x6e, 0x6e, 0x65, 0x6c,
]);

/** HPACK static-table indices that mean an authority is present. */
const STATIC_AUTHORITY = 1;
const STATIC_HOST = 38;

/**
 * Create the stateful inbound transform. Feed it every chunk received from
 * the tunnel server; it returns the bytes to hand to the HTTP/2 session
 * (possibly empty while a frame spans chunks, possibly patched).
 */
export function createAuthorityShim(): (chunk: Buffer) => Buffer {
  let pending: Buffer = Buffer.alloc(0);
  let magicRemaining = CLIENT_MAGIC_LEN;
  /** Bytes of the current frame's payload still to pass through verbatim. */
  let passthroughRemaining = 0;
  let maxSeenStreamId = 0;

  return (chunk: Buffer): Buffer => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    const out: Buffer[] = [];

    // The connection preface (client magic) precedes all frames.
    if (magicRemaining > 0) {
      const take = Math.min(magicRemaining, pending.length);
      out.push(pending.subarray(0, take));
      pending = pending.subarray(take);
      magicRemaining -= take;
    }

    while (pending.length > 0) {
      if (passthroughRemaining > 0) {
        const take = Math.min(passthroughRemaining, pending.length);
        out.push(pending.subarray(0, take));
        pending = pending.subarray(take);
        passthroughRemaining -= take;
        continue;
      }
      if (pending.length < FRAME_HEADER_LEN) break; // wait for a full header

      const length = (pending[0]! << 16) | (pending[1]! << 8) | pending[2]!;
      const type = pending[3]!;
      const flags = pending[4]!;
      const streamId =
        ((pending[5]! & 0x7f) << 24) |
        (pending[6]! << 16) |
        (pending[7]! << 8) |
        pending[8]!;

      const opensStream =
        type === TYPE_HEADERS && streamId > maxSeenStreamId && streamId !== 0;

      const patchable =
        opensStream &&
        (flags & FLAG_END_HEADERS) !== 0 &&
        (flags & (FLAG_PADDED | FLAG_PRIORITY)) === 0 &&
        length <= MAX_PATCHABLE_PAYLOAD;

      if (!patchable) {
        // The stream id is "seen" only once its frame is actually being
        // consumed — a patchable frame still waiting for its payload must
        // re-classify identically on the next chunk.
        if (type === TYPE_HEADERS && streamId > maxSeenStreamId) {
          maxSeenStreamId = streamId;
        }
        // Forward the header now and the payload as it arrives.
        out.push(pending.subarray(0, FRAME_HEADER_LEN));
        pending = pending.subarray(FRAME_HEADER_LEN);
        passthroughRemaining = length;
        continue;
      }

      // Candidate for patching: buffer the whole payload first.
      if (pending.length < FRAME_HEADER_LEN + length) break;
      maxSeenStreamId = streamId;
      const header = pending.subarray(0, FRAME_HEADER_LEN);
      const block = pending.subarray(
        FRAME_HEADER_LEN,
        FRAME_HEADER_LEN + length
      );
      pending = pending.subarray(FRAME_HEADER_LEN + length);

      if (definitelyLacksAuthority(block)) {
        const newLength = length + AUTHORITY_FIELD.length;
        const patchedHeader = Buffer.from(header);
        patchedHeader[0] = (newLength >> 16) & 0xff;
        patchedHeader[1] = (newLength >> 8) & 0xff;
        patchedHeader[2] = newLength & 0xff;
        out.push(patchedHeader, block, AUTHORITY_FIELD);
      } else {
        out.push(header, block);
      }
    }

    return out.length === 1 ? out[0]! : Buffer.concat(out);
  };
}

/**
 * Stateless HPACK scan: `true` only when the block is fully decodable
 * without dynamic-table state AND provably contains no `:authority`/`host`
 * field. Anything uncertain returns `false` (leave the frame alone).
 */
export function definitelyLacksAuthority(block: Buffer): boolean {
  let i = 0;

  // Decode an HPACK prefixed integer; returns -1 on truncation/overflow.
  const readInt = (prefixBits: number): number => {
    const max = (1 << prefixBits) - 1;
    let value = block[i]! & max;
    i++;
    if (value < max) return value;
    let shift = 0;
    while (i < block.length) {
      const b = block[i]!;
      i++;
      value += (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) return value;
      if (shift > 28) return -1;
    }
    return -1;
  };

  // Read a string literal: returns the bytes for plain strings, "huffman"
  // for huffman-coded ones (skipped but not decoded), or null on truncation.
  const readString = (): Buffer | "huffman" | null => {
    if (i >= block.length) return null;
    const huffman = (block[i]! & 0x80) !== 0;
    const len = readInt(7);
    if (len < 0 || i + len > block.length) return null;
    const bytes = block.subarray(i, i + len);
    i += len;
    return huffman ? "huffman" : bytes;
  };

  // Check a field name index/literal; returns true if it could be an
  // authority (or is unknowable), false if it definitely is not.
  const nameCouldBeAuthority = (index: number): boolean | "unknown" => {
    if (index === STATIC_AUTHORITY || index === STATIC_HOST) return true;
    if (index > 61) return "unknown"; // dynamic table — can't know statically
    return false;
  };

  while (i < block.length) {
    const b = block[i]!;
    if ((b & 0x80) !== 0) {
      // Indexed field
      const index = readInt(7);
      if (index < 0) return false;
      const verdict = nameCouldBeAuthority(index);
      if (verdict !== false) return false;
      continue;
    }
    let nameIndex: number;
    if ((b & 0xc0) === 0x40) {
      nameIndex = readInt(6); // literal with incremental indexing
    } else if ((b & 0xe0) === 0x20) {
      const v = readInt(5); // dynamic table size update
      if (v < 0) return false;
      continue;
    } else {
      nameIndex = readInt(4); // literal without/never indexing
    }
    if (nameIndex < 0) return false;
    if (nameIndex === 0) {
      const name = readString();
      if (name === null || name === "huffman") return false; // unknowable
      const n = name.toString("latin1").toLowerCase();
      if (n === ":authority" || n === "host") return false;
    } else {
      const verdict = nameCouldBeAuthority(nameIndex);
      if (verdict !== false) return false;
    }
    const value = readString();
    if (value === null) return false;
  }
  return true;
}
