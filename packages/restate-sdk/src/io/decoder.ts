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

// This is a NodeJs stream transformer. It is used to convert a chunked stream of bytes to
// a stream of JavaScript objects of the form { header: .. , message: ..} where:
// * header has some information about the frame like, the message type, and some flags.
// * message is the Protobuf decoded message.
//
// To use this one would need to do the following:
//
// let decodedStream = stream.pipe(streamDecoder());
//
// at this point the decodedStream is a high level stream of objects {header, message}

import stream from "node:stream";
import { PROTOBUF_MESSAGE_BY_TYPE } from "../types/protocol";
import { Header, Message } from "../types/types";
import { ensureError } from "../types/errors";
import { Buffer } from "node:buffer";
import { readBigUInt64BE } from "../utils/buffer";

type Output = { push(msg: Message): void };
type DecoderState = { state: number; header: Header | undefined; buf: Buffer };

const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

function initialDecoderState(buf: Buffer): DecoderState {
  return {
    state: WAITING_FOR_HEADER,
    header: undefined,
    buf,
  };
}

function appendBufferToDecoder(state: DecoderState, chunk: Buffer) {
  state.buf = Buffer.concat([state.buf, chunk]);
}

function decodeMessages(decoderState: DecoderState, out: Output): DecoderState {
  let buf = decoderState.buf;

  while (buf.length > 0 || decoderState.state === WAITING_FOR_BODY) {
    switch (decoderState.state) {
      case WAITING_FOR_HEADER: {
        assert(decoderState.header === undefined);
        if (buf.length < 8) {
          decoderState.buf = buf;
          return decoderState;
        }
        const h = readBigUInt64BE(buf);
        buf = buf.subarray(8);
        const materializedHeader = Header.fromU64be(h);
        decoderState.header = materializedHeader;
        decoderState.state = WAITING_FOR_BODY;

        break;
      }
      case WAITING_FOR_BODY: {
        const header = decoderState.header;
        assert(header !== undefined);

        if (buf.length < header.frameLength) {
          decoderState.buf = buf;
          return decoderState;
        }
        const frame = buf.subarray(0, header.frameLength);
        buf = buf.subarray(header.frameLength);
        decoderState.state = WAITING_FOR_HEADER;
        decoderState.header = undefined;

        const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.messageType);
        if (pbType === undefined) {
          throw new Error("Got unknown message type " + header.messageType);
        } else {
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
          const message = (pbType as any).fromBinary(frame);
          out.push(
            new Message(
              header.messageType,
              message,
              header.completedFlag,
              header.requiresAckFlag
            )
          );
        }
        break;
      }
    }
  }

  decoderState.buf = buf;
  return decoderState;
}

export function streamDecoder(): stream.Transform {
  let decoderState = initialDecoderState(Buffer.alloc(0));

  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(chunk, _encoding, cb) {
      try {
        appendBufferToDecoder(decoderState, chunk);
        decoderState = decodeMessages(decoderState, this);
        cb();
      } catch (e) {
        cb(ensureError(e), null);
      }
    },
  });
}

const base64regex =
  /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;

export function decodeLambdaBody(msgBase64: string): Message[] {
  if (!base64regex.test(msgBase64)) {
    throw new Error(
      "Cannot parse the lambda request body, body was not valid base64 encoded: " +
        msgBase64
    );
  }
  const buffer = Buffer.from(msgBase64, "base64");
  return decodeMessagesBuffer(buffer);
}

export function decodeMessagesBuffer(buffer: Buffer): Message[] {
  const decodedEntries: Message[] = [];
  let finalState;
  try {
    finalState = decodeMessages(initialDecoderState(buffer), decodedEntries);
  } catch (e) {
    const err = ensureError(e);
    throw new Error(
      "Cannot parse the lambda request body, message was not a valid sequence of Restate messages: " +
        err.message,
      { cause: err }
    );
  }

  if (finalState.buf.length > 0) {
    throw new Error(
      "Cannot parse the request body: Trailing data (incomplete message) in request body: " +
        finalState.buf.toString("hex")
    );
  }

  return decodedEntries;
}

function assert(value: boolean, msg?: string): asserts value {
  if (!value) throw new Error(msg || "assertion error");
}
