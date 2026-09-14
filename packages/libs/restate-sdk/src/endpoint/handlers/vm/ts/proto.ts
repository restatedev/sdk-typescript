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
 * Minimal protobuf (proto3) wire format reader/writer, plus a tiny
 * descriptor-driven message codec.
 *
 * This is intentionally small and dependency free: it only supports what the
 * Restate service protocol needs (varint, 64-bit varint as bigint, bytes,
 * strings, nested messages, packed/unpacked repeated scalars, proto3
 * `optional` and `oneof` presence semantics, unknown field skipping).
 */

export const enum WireType {
  Varint = 0,
  Fixed64 = 1,
  LengthDelimited = 2,
  StartGroup = 3,
  EndGroup = 4,
  Fixed32 = 5,
}

const textEncoder = new TextEncoder();
const lossyTextDecoder = new TextDecoder("utf-8", { fatal: false });
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

export function utf8Encode(s: string): Uint8Array {
  return textEncoder.encode(s);
}

/** Lossy decode, for places where the shared core uses `String::from_utf8_lossy`. */
export function utf8Decode(b: Uint8Array): string {
  return lossyTextDecoder.decode(b);
}

/**
 * Strict decode, for proto3 `string` fields. Invalid UTF-8 is a decode error in
 * protobuf, so it must not be silently replaced with U+FFFD.
 */
export function utf8DecodeStrict(b: Uint8Array): string {
  return strictTextDecoder.decode(b);
}

/**
 * Compares two byte strings lexicographically, like Rust's `Ord for [u8]`.
 * JavaScript string comparison orders by UTF-16 code unit, which disagrees with
 * UTF-8 byte order for anything outside the BMP.
 */
export function compareUtf8(a: string, b: string): number {
  const ab = textEncoder.encode(a);
  const bb = textEncoder.encode(b);
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    if (ab[i] !== bb[i]) {
      return ab[i]! - bb[i]!;
    }
  }
  return ab.length - bb.length;
}

export class ProtoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtoDecodeError";
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export class ProtoWriter {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(initialCapacity);
  }

  get length(): number {
    return this.pos;
  }

  private ensure(extra: number) {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) {
      return;
    }
    let newCap = this.buf.length * 2;
    while (newCap < needed) {
      newCap *= 2;
    }
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buf.subarray(0, this.pos));
    this.buf = newBuf;
  }

  writeByte(b: number) {
    this.ensure(1);
    this.buf[this.pos++] = b & 0xff;
  }

  writeVarint32(value: number) {
    // Treat as unsigned 32 bit
    let v = value >>> 0;
    this.ensure(5);
    while (v > 0x7f) {
      this.buf[this.pos++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.buf[this.pos++] = v;
  }

  writeVarint64(value: bigint) {
    let v = BigInt.asUintN(64, value);
    this.ensure(10);
    while (v > 0x7fn) {
      this.buf[this.pos++] = Number(v & 0x7fn) | 0x80;
      v >>= 7n;
    }
    this.buf[this.pos++] = Number(v);
  }

  writeTag(fieldNo: number, wireType: WireType) {
    this.writeVarint32((fieldNo << 3) | wireType);
  }

  writeRaw(bytes: Uint8Array) {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  writeLengthDelimited(fieldNo: number, bytes: Uint8Array) {
    this.writeTag(fieldNo, WireType.LengthDelimited);
    this.writeVarint32(bytes.length);
    this.writeRaw(bytes);
  }

  writeStringField(fieldNo: number, value: string) {
    this.writeLengthDelimited(fieldNo, utf8Encode(value));
  }

  writeUint32Field(fieldNo: number, value: number) {
    this.writeTag(fieldNo, WireType.Varint);
    this.writeVarint32(value);
  }

  writeUint64Field(fieldNo: number, value: bigint) {
    this.writeTag(fieldNo, WireType.Varint);
    this.writeVarint64(value);
  }

  writeBoolField(fieldNo: number, value: boolean) {
    this.writeTag(fieldNo, WireType.Varint);
    this.writeByte(value ? 1 : 0);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export class ProtoReader {
  private pos: number;
  private readonly end: number;

  constructor(
    private readonly buf: Uint8Array,
    start = 0,
    end = buf.length
  ) {
    this.pos = start;
    this.end = end;
  }

  eof(): boolean {
    return this.pos >= this.end;
  }

  readByte(): number {
    if (this.pos >= this.end) {
      throw new ProtoDecodeError("unexpected end of buffer");
    }
    return this.buf[this.pos++]!;
  }

  readVarint32(): number {
    // Reads up to 10 bytes, keeps the low 32 bits.
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      const b = this.readByte();
      if (shift < 32) {
        result |= (b & 0x7f) << shift;
      }
      shift += 7;
      if ((b & 0x80) === 0) {
        return result >>> 0;
      }
    }
    throw new ProtoDecodeError("varint too long");
  }

  readVarint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      const b = this.readByte();
      result |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if ((b & 0x80) === 0) {
        return BigInt.asUintN(64, result);
      }
    }
    throw new ProtoDecodeError("varint too long");
  }

  readTag(): { fieldNo: number; wireType: WireType } {
    const tag = this.readVarint32();
    const fieldNo = tag >>> 3;
    const wireType = (tag & 0x7) as WireType;
    if (fieldNo === 0) {
      throw new ProtoDecodeError("invalid field number 0");
    }
    return { fieldNo, wireType };
  }

  readBytes(): Uint8Array {
    const len = this.readVarint32();
    if (this.pos + len > this.end) {
      throw new ProtoDecodeError("length delimited field exceeds buffer");
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  readString(): string {
    return utf8DecodeStrict(this.readBytes());
  }

  /** Returns [start, end) of a length delimited field, advancing the cursor. */
  readLengthDelimitedRange(): { start: number; end: number } {
    const len = this.readVarint32();
    if (this.pos + len > this.end) {
      throw new ProtoDecodeError("length delimited field exceeds buffer");
    }
    const start = this.pos;
    this.pos += len;
    return { start, end: this.pos };
  }

  skip(wireType: WireType) {
    switch (wireType) {
      case WireType.Varint:
        this.readVarint64();
        return;
      case WireType.Fixed64:
        this.pos += 8;
        if (this.pos > this.end) {
          throw new ProtoDecodeError("unexpected end of buffer");
        }
        return;
      case WireType.LengthDelimited:
        this.readBytes();
        return;
      case WireType.Fixed32:
        this.pos += 4;
        if (this.pos > this.end) {
          throw new ProtoDecodeError("unexpected end of buffer");
        }
        return;
      case WireType.StartGroup:
      case WireType.EndGroup:
      default:
        throw new ProtoDecodeError(`unsupported wire type ${wireType}`);
    }
  }

  get buffer(): Uint8Array {
    return this.buf;
  }
}

// ---------------------------------------------------------------------------
// Descriptor driven codec
// ---------------------------------------------------------------------------

export type ScalarKind =
  | "uint32"
  | "uint64"
  | "bool"
  | "string"
  | "bytes"
  | "enum";

export interface FieldDesc {
  readonly no: number;
  readonly name: string;
  readonly kind: ScalarKind | "message";
  /** For kind === "message" */
  readonly message?: MessageDesc<object>;
  readonly repeated?: boolean;
  /**
   * Explicit presence tracking (proto3 `optional` or oneof member): the field
   * is encoded whenever the value is !== undefined, even when it equals the
   * default value. Non-presence scalars follow proto3 rules (defaults are not
   * encoded and are materialized on decode).
   */
  readonly presence?: boolean;
  /** Oneof group name: decoding a member clears the other members. */
  readonly oneof?: string;
}

export interface MessageDesc<T extends object> {
  readonly name: string;
  readonly fields: readonly FieldDesc[];
  /** Phantom, only used to carry the TS type. */
  readonly __type?: T;
}

export function desc<T extends object>(
  name: string,
  fields: readonly FieldDesc[]
): MessageDesc<T> {
  return { name, fields };
}

type AnyRecord = Record<string, unknown>;

function scalarDefault(kind: ScalarKind): unknown {
  switch (kind) {
    case "uint32":
    case "enum":
      return 0;
    case "uint64":
      return 0n;
    case "bool":
      return false;
    case "string":
      return "";
    case "bytes":
      return new Uint8Array(0);
  }
}

/**
 * Creates a message of the given descriptor, filling in the proto3 defaults
 * for every field not provided in `init`.
 */
export function create<T extends object>(
  d: MessageDesc<T>,
  init: Partial<T> = {}
): T {
  const out: AnyRecord = {};
  for (const f of d.fields) {
    const provided = (init as AnyRecord)[f.name];
    if (f.repeated) {
      out[f.name] = provided !== undefined ? provided : [];
    } else if (f.presence || f.kind === "message") {
      out[f.name] = provided;
    } else {
      out[f.name] = provided !== undefined ? provided : scalarDefault(f.kind);
    }
  }
  return out as T;
}

function isDefault(kind: ScalarKind, v: unknown): boolean {
  switch (kind) {
    case "uint32":
    case "enum":
      return v === 0;
    case "uint64":
      return v === 0n;
    case "bool":
      return v === false;
    case "string":
      return v === "";
    case "bytes":
      return (v as Uint8Array).length === 0;
  }
}

function writeScalar(w: ProtoWriter, f: FieldDesc, v: unknown) {
  switch (f.kind) {
    case "uint32":
    case "enum":
      w.writeUint32Field(f.no, v as number);
      return;
    case "uint64":
      w.writeUint64Field(f.no, v as bigint);
      return;
    case "bool":
      w.writeBoolField(f.no, v as boolean);
      return;
    case "string":
      w.writeStringField(f.no, v as string);
      return;
    case "bytes":
      w.writeLengthDelimited(f.no, v as Uint8Array);
      return;
    case "message":
      w.writeLengthDelimited(
        f.no,
        encodeMessage(f.message as MessageDesc<object>, v as object)
      );
      return;
  }
}

export function encodeMessage<T extends object>(
  d: MessageDesc<T>,
  msg: T
): Uint8Array {
  const w = new ProtoWriter();
  encodeMessageInto(w, d, msg);
  return w.finish();
}

export function encodeMessageInto<T extends object>(
  w: ProtoWriter,
  d: MessageDesc<T>,
  msg: T
) {
  const rec = msg as AnyRecord;
  for (const f of d.fields) {
    const v = rec[f.name];
    if (v === undefined || v === null) {
      continue;
    }
    if (f.repeated) {
      const arr = v as unknown[];
      if (arr.length === 0) {
        continue;
      }
      if (
        f.kind === "uint32" ||
        f.kind === "uint64" ||
        f.kind === "bool" ||
        f.kind === "enum"
      ) {
        // Packed encoding for repeated scalars (proto3 default)
        const inner = new ProtoWriter();
        for (const item of arr) {
          if (f.kind === "uint64") {
            inner.writeVarint64(item as bigint);
          } else if (f.kind === "bool") {
            inner.writeByte((item as boolean) ? 1 : 0);
          } else {
            inner.writeVarint32(item as number);
          }
        }
        w.writeLengthDelimited(f.no, inner.finish());
      } else {
        for (const item of arr) {
          writeScalar(w, f, item);
        }
      }
      continue;
    }
    if (f.kind === "message") {
      writeScalar(w, f, v);
      continue;
    }
    if (!f.presence && isDefault(f.kind, v)) {
      continue;
    }
    writeScalar(w, f, v);
  }
}

function readScalar(r: ProtoReader, f: FieldDesc, wireType: WireType): unknown {
  switch (f.kind) {
    case "uint32":
    case "enum":
      if (wireType !== WireType.Varint) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected varint, got wire type ${wireType}`
        );
      }
      return r.readVarint32();
    case "uint64":
      if (wireType !== WireType.Varint) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected varint, got wire type ${wireType}`
        );
      }
      return r.readVarint64();
    case "bool":
      if (wireType !== WireType.Varint) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected varint, got wire type ${wireType}`
        );
      }
      return r.readVarint64() !== 0n;
    case "string":
      if (wireType !== WireType.LengthDelimited) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected length delimited, got wire type ${wireType}`
        );
      }
      return r.readString();
    case "bytes":
      if (wireType !== WireType.LengthDelimited) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected length delimited, got wire type ${wireType}`
        );
      }
      // Copy out: the input buffer may be reused, and it is often a Node
      // `Buffer` whose `slice` returns a view rather than a copy.
      return new Uint8Array(r.readBytes());
    case "message": {
      if (wireType !== WireType.LengthDelimited) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected length delimited, got wire type ${wireType}`
        );
      }
      const { start, end } = r.readLengthDelimitedRange();
      return decodeMessageRange(
        f.message as MessageDesc<object>,
        r.buffer,
        start,
        end
      );
    }
  }
}

export function decodeMessage<T extends object>(
  d: MessageDesc<T>,
  buf: Uint8Array
): T {
  return decodeMessageRange(d, buf, 0, buf.length);
}

function decodeMessageRange<T extends object>(
  d: MessageDesc<T>,
  buf: Uint8Array,
  start: number,
  end: number
): T {
  const out = create(d) as AnyRecord;
  const pendingMessages = new Map<string, PendingMessageField>();
  const r = new ProtoReader(buf, start, end);
  while (!r.eof()) {
    const { fieldNo, wireType } = r.readTag();
    const f = d.fields.find((x) => x.no === fieldNo);
    if (f === undefined) {
      r.skip(wireType);
      continue;
    }
    if (f.repeated) {
      const arr = out[f.name] as unknown[];
      const isPackable =
        f.kind === "uint32" ||
        f.kind === "uint64" ||
        f.kind === "bool" ||
        f.kind === "enum";
      if (isPackable && wireType === WireType.LengthDelimited) {
        const { start: s, end: e } = r.readLengthDelimitedRange();
        const inner = new ProtoReader(buf, s, e);
        while (!inner.eof()) {
          if (f.kind === "uint64") {
            arr.push(inner.readVarint64());
          } else if (f.kind === "bool") {
            arr.push(inner.readVarint64() !== 0n);
          } else {
            arr.push(inner.readVarint32());
          }
        }
      } else {
        arr.push(readScalar(r, f, wireType));
      }
      continue;
    }
    if (f.kind === "message") {
      // A non-repeated message field occurring more than once is merged, which
      // protobuf defines as concatenating the encodings and parsing once. Defer
      // the decode so a later occurrence can still contribute.
      if (wireType !== WireType.LengthDelimited) {
        throw new ProtoDecodeError(
          `field ${f.name}: expected length delimited, got wire type ${wireType}`
        );
      }
      const { start: ms, end: me } = r.readLengthDelimitedRange();
      clearOtherOneofMembers(d, f, out, pendingMessages);
      const pending = pendingMessages.get(f.name);
      if (pending !== undefined) {
        pending.chunks.push(buf.subarray(ms, me));
      } else {
        pendingMessages.set(f.name, {
          field: f,
          chunks: [buf.subarray(ms, me)],
        });
      }
      continue;
    }
    const value = readScalar(r, f, wireType);
    if (f.oneof !== undefined) {
      clearOtherOneofMembers(d, f, out, pendingMessages);
    }
    out[f.name] = value;
  }

  for (const { field, chunks } of pendingMessages.values()) {
    const bytes = chunks.length === 1 ? chunks[0]! : concatBytes(chunks);
    out[field.name] = decodeMessageRange(
      field.message as MessageDesc<object>,
      bytes,
      0,
      bytes.length
    );
  }

  return out as T;
}

interface PendingMessageField {
  field: FieldDesc;
  chunks: Uint8Array[];
}

/** Last one wins: clear the other members of the field's oneof group. */
function clearOtherOneofMembers<T extends object>(
  d: MessageDesc<T>,
  f: FieldDesc,
  out: AnyRecord,
  pendingMessages: Map<string, PendingMessageField>
) {
  if (f.oneof === undefined) {
    return;
  }
  for (const other of d.fields) {
    if (other.oneof === f.oneof && other.name !== f.name) {
      out[other.name] = undefined;
      pendingMessages.delete(other.name);
    }
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural equality (descriptor driven)
// ---------------------------------------------------------------------------

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function scalarEqual(f: FieldDesc, a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  switch (f.kind) {
    case "bytes":
      return bytesEqual(a as Uint8Array, b as Uint8Array);
    case "message":
      return messageEquals(
        f.message as MessageDesc<object>,
        a as object,
        b as object
      );
    default:
      return a === b;
  }
}

/**
 * Deep structural equality of two messages of the same descriptor. Mirrors the
 * derived `PartialEq` of the prost generated structs.
 */
export function messageEquals<T extends object>(
  d: MessageDesc<T>,
  a: T,
  b: T
): boolean {
  const ra = a as AnyRecord;
  const rb = b as AnyRecord;
  for (const f of d.fields) {
    const va = ra[f.name];
    const vb = rb[f.name];
    if (f.repeated) {
      const aa = (va as unknown[] | undefined) ?? [];
      const ab = (vb as unknown[] | undefined) ?? [];
      if (aa.length !== ab.length) {
        return false;
      }
      for (let i = 0; i < aa.length; i++) {
        if (!scalarEqual(f, aa[i], ab[i])) {
          return false;
        }
      }
      continue;
    }
    if (!scalarEqual(f, va, vb)) {
      return false;
    }
  }
  return true;
}
