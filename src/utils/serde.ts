import { Buffer } from "node:buffer";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function serializeJson(item: any | undefined): Uint8Array {
  if (item === undefined) {
    return Buffer.alloc(0);
  }
  const str = JSON.stringify(item);
  return Buffer.from(str);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function deserializeJson(buf: Uint8Array): any | undefined {
  if (buf.length === 0) {
    return undefined;
  }
  const b = Buffer.from(buf);
  const str = b.toString("utf8");
  return JSON.parse(str);
}
