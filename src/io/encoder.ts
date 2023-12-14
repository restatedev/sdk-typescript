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

import stream from "stream";
import { PROTOBUF_MESSAGE_BY_TYPE } from "../types/protocol";
import { Header, Message } from "../types/types";
import _m0 from "protobufjs/minimal";

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
  const offsets = [];
  const headers = [];
  let off = 0;

  const writer = _m0.Writer.create();
  for (const message of messages) {
    const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(BigInt(message.messageType));
    if (pbType === undefined) {
      throw new Error(
        "Trying to encode a message with unknown message type " +
          message.messageType
      );
    }
    offsets.push(off);
    writer.fixed64(0);
    pbType.encode(message.message, writer);
    const messageLen = writer.len - 8 - off;
    off = writer.len;

    const header = new Header(
      BigInt(message.messageType),
      messageLen,
      message.completed,
      message.protocolVersion, // only set for incoming start message
      message.requiresAck
    );
    const header64 = header.toU64be();
    headers.push(header64);
  }
  const buffer = writer.finish() as Buffer;
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    const header = headers[i];
    buffer.writeBigUInt64BE(header, offset);
  }
  return buffer;
}
