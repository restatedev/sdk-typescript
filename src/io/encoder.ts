"use strict";

import stream from "stream";
import { PROTOBUF_MESSAGE_BY_TYPE, ProtocolMessage } from "../types/protocol";
import { Header } from "../types/types";

interface EncoderOpts {
  messageType: bigint;
  message: ProtocolMessage | Uint8Array;
  version?: number;
  completed?: boolean;
  requiresAck?: boolean;
}

export function streamEncoder(): stream.Transform {
  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(chunk, _encoding, cb) {
      // We do not catch errors here because we want them to be handled at the Connection level,
      // so we can close the state machine.
      const result = encodeMessage(chunk);
      cb(null, result);
    },
  });
}

export function encodeMessage({
  messageType,
  message,
  version,
  completed,
  requiresAck,
}: EncoderOpts): Uint8Array {
  const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(BigInt(messageType));
  let bodyBuf;
  if (pbType === undefined) {
    // this is a custom message.
    // in this case we expect it to be already encoded.
    bodyBuf = message as Uint8Array;
  } else {
    bodyBuf = pbType.encode(message).finish();
  }
  const header = new Header(
    BigInt(messageType),
    bodyBuf.length,
    completed,
    version,
    requiresAck
  );
  const headerBuf = Buffer.alloc(8);
  const encoded = header.toU64be();
  headerBuf.writeBigUInt64BE(encoded);
  return Buffer.concat([headerBuf, bodyBuf]);
}
