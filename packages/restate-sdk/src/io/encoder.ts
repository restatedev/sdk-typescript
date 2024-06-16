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

import stream from "node:stream";
import { PROTOBUF_MESSAGE_BY_TYPE } from "../types/protocol";
import { Header, Message } from "../types/types";
import { Buffer } from "node:buffer";

export function streamEncoder(): stream.Transform {
  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(msg, _encoding, cb) {
      // We do not catch errors here because we want them to be handled at the Connection level,
      // so we can close the state machine.
      const result = encodeMessage(msg);
      cb(null, result);
    },
  });
}

export function encodeMessage(msg: Message): Uint8Array {
  return encodeMessages([msg]);
}

export function encodeMessages(messages: Message[]): Uint8Array {
  const chunks = [];

  for (const message of messages) {
    const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(message.messageType);
    if (pbType === undefined) {
      throw new Error(
        "Trying to encode a message with unknown message type " +
          message.messageType
      );
    }

    const buf = message.message.toBinary();

    const header = new Header(
      BigInt(message.messageType),
      buf.length,
      message.completed,
      message.requiresAck
    );
    const header64 = header.toU64be();
    const headerBuf = Buffer.alloc(8);
    writeBigUInt64BE(header64, headerBuf);
    chunks.push(headerBuf);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function writeBigUInt64BE(value: bigint, buf: Buffer, offset = 0): number {
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
