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
import { writeBigUInt64BE } from "../utils/buffer";

export function streamEncoder(): stream.Transform {
  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(msg, _encoding, cb) {
      // We do not catch errors here because we want them to be handled at the Connection level,
      // so we can close the state machine.
      const result = encodeMessage(msg as Message);
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
