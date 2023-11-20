/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

//! Some parts copied from https://github.com/uuidjs/uuid/blob/main/src/stringify.js
//! License MIT

import {Rand} from "../restate_context";

export class RandImpl implements Rand {
  private randstate64: bigint;

  constructor(id: Buffer | bigint) {
    if (typeof id == "bigint") {
      this.randstate64 = id
    } else {
      // seed using last 64 (random) bits of the invocation ID
      this.randstate64 = id.readBigUInt64LE(id.byteLength - 8);
    }
  }

  static U64_MASK = ((1n << 64n) - 1n)

  // splitmix64
  // https://prng.di.unimi.it/splitmix64.c - public domain
  u64(): bigint {
    this.randstate64 = (this.randstate64 + 0x9e3779b97f4a7c15n) & RandImpl.U64_MASK;
    let next: bigint = this.randstate64;
    next = ((next ^ (next >> 30n)) * 0xbf58476d1ce4e5b9n) & RandImpl.U64_MASK;
    next = ((next ^ (next >> 27n)) * 0x94d049bb133111ebn) & RandImpl.U64_MASK;
    next = next ^ (next >> 31n);
    return next
  }

  static U53_MASK = ((1n << 53n) - 1n)

  public random(): number {
    // first generate a uint in range [0,2^53), which can be mapped 1:1 to a float64 in [0,1)
    const u53 = this.u64() & RandImpl.U53_MASK
    // then divide by 2^53, which will simply update the exponent
    return Number(u53) / 2 ** 53
  }

  public uuidv4(): string {
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(this.u64(), 0);
    buf.writeBigUInt64LE(this.u64(), 8);
    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    return uuidStringify(buf)
  }

  public clone(): Rand {
    // clone current state so we can 'peek' at the next u64 we would have emitted
    const cloned = new RandImpl(this.randstate64)
    // use that u64 as the initial state for another Rand instance; this means it should produce numbers we
    // weren't about to produce in the original instance
    return new RandImpl(cloned.u64())
  }
}

const byteToHex: string[] = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
function uuidStringify(arr: Buffer, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  //
  // Note to future-self: No, you can't remove the `toLowerCase()` call.
  // REF: https://github.com/uuidjs/uuid/pull/677#issuecomment-1757351351
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}
