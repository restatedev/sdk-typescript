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

//! Some parts copied from https://github.com/uuidjs/uuid/blob/main/src/stringify.js
//! License MIT

import { Rand } from "../context";
import { INTERNAL_ERROR_CODE, TerminalError } from "../types/errors";
import { CallContextType, ContextImpl } from "../context_impl";
import { createHash } from "crypto";

export class RandImpl implements Rand {
  private randstate256: [bigint, bigint, bigint, bigint];

  constructor(id: Buffer | [bigint, bigint, bigint, bigint]) {
    if (id instanceof Buffer) {
      // hash the invocation ID, which is known to contain 74 bits of entropy
      const hash = createHash("sha256").update(id).digest();

      this.randstate256 = [
        hash.readBigUInt64LE(0),
        hash.readBigUInt64LE(8),
        hash.readBigUInt64LE(16),
        hash.readBigUInt64LE(24),
      ];
    } else {
      this.randstate256 = id;
    }
  }

  static U64_MASK = (1n << 64n) - 1n;

  // xoshiro256++
  // https://prng.di.unimi.it/xoshiro256plusplus.c - public domain
  u64(): bigint {
    const result: bigint =
      (RandImpl.rotl(
        (this.randstate256[0] + this.randstate256[3]) & RandImpl.U64_MASK,
        23n
      ) +
        this.randstate256[0]) &
      RandImpl.U64_MASK;

    const t: bigint = (this.randstate256[1] << 17n) & RandImpl.U64_MASK;

    this.randstate256[2] ^= this.randstate256[0];
    this.randstate256[3] ^= this.randstate256[1];
    this.randstate256[1] ^= this.randstate256[2];
    this.randstate256[0] ^= this.randstate256[3];

    this.randstate256[2] ^= t;

    this.randstate256[3] = RandImpl.rotl(this.randstate256[3], 45n);

    return result;
  }

  static rotl(x: bigint, k: bigint): bigint {
    return ((x << k) & RandImpl.U64_MASK) | (x >> (64n - k));
  }

  checkContext() {
    const context = ContextImpl.callContext.getStore();
    if (context && context.type === CallContextType.Run) {
      throw new TerminalError(
        `You may not call methods on Rand from within a run().`,
        { errorCode: INTERNAL_ERROR_CODE }
      );
    }
  }

  static U53_MASK = (1n << 53n) - 1n;

  public random(): number {
    this.checkContext();

    // first generate a uint in range [0,2^53), which can be mapped 1:1 to a float64 in [0,1)
    const u53 = this.u64() & RandImpl.U53_MASK;
    // then divide by 2^53, which will simply update the exponent
    return Number(u53) / 2 ** 53;
  }

  public uuidv4(): string {
    this.checkContext();

    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(this.u64(), 0);
    buf.writeBigUInt64LE(this.u64(), 8);
    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    return uuidStringify(buf);
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
    "-" +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    "-" +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    "-" +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    "-" +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}
