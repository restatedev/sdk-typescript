"use strict";

import stream from "stream";
import { PROTOBUF_MESSAGE_BY_TYPE } from "../types/protocol";
import { Header, Message } from "../types/types";

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
  const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(BigInt(msg.messageType));
  let bodyBuf;
  if (pbType === undefined) {
    // this is a custom message.
    // in this case we expect it to be already encoded.
    bodyBuf = msg.message as Uint8Array;
  } else {
    bodyBuf = pbType.encode(msg.message).finish();
  }
  const header = new Header(
    BigInt(msg.messageType),
    bodyBuf.length,
    msg.completed,
    msg.protocolVersion, // only set for incoming start message
    msg.requiresAck
  );
  const headerBuf = Buffer.alloc(8);
  const encoded = header.toU64be();
  headerBuf.writeBigUInt64BE(encoded);
  return Buffer.concat([headerBuf, bodyBuf]);
}
