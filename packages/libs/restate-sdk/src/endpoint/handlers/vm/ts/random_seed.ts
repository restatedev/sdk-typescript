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
 * Random seed derivation for protocol versions < V6, where the runtime doesn't
 * provide a seed. Mirrors `compute_random_seed` in the shared core, which uses
 * Rust's `DefaultHasher` (SipHash-1-3 with zero keys) over the invocation id
 * bytes, hashed as a `[u8]` slice: a `usize` length prefix (4 bytes on
 * wasm32, little endian) followed by the bytes.
 */

const MASK64 = (1n << 64n) - 1n;

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function u8ToLeU64(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i]!);
  }
  return v;
}

/** SipHash-1-3 (as used by Rust's `DefaultHasher`) with zero keys. */
export function sipHash13(data: Uint8Array): bigint {
  const k0 = 0n;
  const k1 = 0n;
  let v0 = k0 ^ 0x736f6d6570736575n;
  let v1 = k1 ^ 0x646f72616e646f6dn;
  let v2 = k0 ^ 0x6c7967656e657261n;
  let v3 = k1 ^ 0x7465646279746573n;

  const sipRound = () => {
    v0 = (v0 + v1) & MASK64;
    v1 = rotl(v1, 13n);
    v1 ^= v0;
    v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK64;
    v3 = rotl(v3, 16n);
    v3 ^= v2;
    v0 = (v0 + v3) & MASK64;
    v3 = rotl(v3, 21n);
    v3 ^= v0;
    v2 = (v2 + v1) & MASK64;
    v1 = rotl(v1, 17n);
    v1 ^= v2;
    v2 = rotl(v2, 32n);
  };

  const len = data.length;
  const blocks = Math.floor(len / 8);
  for (let i = 0; i < blocks; i++) {
    const m = u8ToLeU64(data, i * 8);
    v3 ^= m;
    sipRound();
    v0 ^= m;
  }

  // Tail: remaining bytes + length in the top byte
  let b = BigInt(len & 0xff) << 56n;
  const tailStart = blocks * 8;
  for (let i = 0; i < len - tailStart; i++) {
    b |= BigInt(data[tailStart + i]!) << BigInt(8 * i);
  }

  v3 ^= b;
  sipRound();
  v0 ^= b;

  v2 ^= 0xffn;
  sipRound();
  sipRound();
  sipRound();

  return (v0 ^ v1 ^ v2 ^ v3) & MASK64;
}

/** Computes the random seed like the wasm32 build of the shared core. */
export function computeRandomSeed(id: Uint8Array): bigint {
  // `<[u8] as Hash>::hash` writes the length prefix as usize (4 bytes on wasm32) then the bytes
  const buf = new Uint8Array(4 + id.length);
  const len = id.length >>> 0;
  buf[0] = len & 0xff;
  buf[1] = (len >>> 8) & 0xff;
  buf[2] = (len >>> 16) & 0xff;
  buf[3] = (len >>> 24) & 0xff;
  buf.set(id, 4);
  return sipHash13(buf);
}
