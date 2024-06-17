// Functions adapted from https://github.com/nodejs/node/blob/main/lib/internal/buffer.js
// MIT licensed
// Copyright Node.js contributors

export function readBigUInt64LE(buf: Uint8Array, offset = 0): bigint {
  const first = buf[offset];
  const last = buf[offset + 7];
  if (first === undefined || last === undefined)
    throw new Error("out of bounds");

  const lo =
    first +
    buf[++offset] * 2 ** 8 +
    buf[++offset] * 2 ** 16 +
    buf[++offset] * 2 ** 24;

  const hi =
    buf[++offset] +
    buf[++offset] * 2 ** 8 +
    buf[++offset] * 2 ** 16 +
    last * 2 ** 24;

  return BigInt(lo) + (BigInt(hi) << 32n);
}

export function readBigUInt64BE(buf: Uint8Array, offset = 0): bigint {
  const first = buf[offset];
  const last = buf[offset + 7];
  if (first === undefined || last === undefined)
    throw new Error("out of bounds");
  const hi =
    first * 2 ** 24 +
    buf[++offset] * 2 ** 16 +
    buf[++offset] * 2 ** 8 +
    buf[++offset];
  const lo =
    buf[++offset] * 2 ** 24 +
    buf[++offset] * 2 ** 16 +
    buf[++offset] * 2 ** 8 +
    last;
  return (BigInt(hi) << 32n) + BigInt(lo);
}

export function writeBigUInt64BE(
  value: bigint,
  buf: Buffer,
  offset = 0
): number {
  let lo = Number(value & 0xffffffffn);
  buf[offset + 7] = lo;
  lo = lo >> 8;
  buf[offset + 6] = lo;
  lo = lo >> 8;
  buf[offset + 5] = lo;
  lo = lo >> 8;
  buf[offset + 4] = lo;
  let hi = Number((value >> 32n) & 0xffffffffn);
  buf[offset + 3] = hi;
  hi = hi >> 8;
  buf[offset + 2] = hi;
  hi = hi >> 8;
  buf[offset + 1] = hi;
  hi = hi >> 8;
  buf[offset] = hi;
  return offset + 8;
}
