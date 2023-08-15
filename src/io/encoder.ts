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
import { assert } from "console";

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
  assert(pbType !== undefined);

  const bodyBuf = pbType.encode(msg.message).finish();
  const header = new Header(
    BigInt(msg.messageType),
    bodyBuf.length,
    msg.completed,
    msg.protocolVersion, // only set for incoming start message
    msg.requiresAck,
    msg.partialStateFlag
  );
  const headerBuf = Buffer.alloc(8);
  const encoded = header.toU64be();
  headerBuf.writeBigUInt64BE(encoded);
  return Buffer.concat([headerBuf, bodyBuf]);
}
