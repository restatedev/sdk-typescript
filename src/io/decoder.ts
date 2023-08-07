"use strict";

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
import stream from "stream";
import { PROTOBUF_MESSAGE_BY_TYPE } from "../types/protocol";
import { Header, Message } from "../types/types";
import assert from "assert";
import { ensureError } from "../types/errors";

type Output = { push(msg: Message): void };

const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

function decodeMessages(buf: Buffer, out: Output): Buffer {
  let state = WAITING_FOR_HEADER;
  let header: Header | undefined;

  while (buf.length > 0 || state === WAITING_FOR_BODY) {
    switch (state) {
      case WAITING_FOR_HEADER: {
        if (buf.length < 8) {
          return buf;
        }
        const h = buf.readBigUInt64BE();
        buf = buf.subarray(8);
        header = Header.fromU64be(h);
        state = WAITING_FOR_BODY;
        break;
      }
      case WAITING_FOR_BODY: {
        assert(header !== undefined);
        if (buf.length < header.frameLength) {
          return buf;
        }
        const frame = buf.subarray(0, header.frameLength);
        buf = buf.subarray(header.frameLength);
        state = WAITING_FOR_HEADER;

        const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.messageType);
        if (pbType === undefined) {
          // this is a custom message.
          // we don't know how to decode custom message
          // so we let the user of this stream to deal with custom
          // message serde

          out.push(
            new Message(
              header.messageType,
              frame,
              header.completedFlag,
              header.protocolVersion,
              header.requiresAckFlag,
              header.partialStateFlag
            )
          );
        } else {
          const message = pbType.decode(frame);
          out.push(
            new Message(
              header.messageType,
              message,
              header.completedFlag,
              header.protocolVersion,
              header.requiresAckFlag,
              header.partialStateFlag
            )
          );
        }
        break;
      }
    }
  }

  return buf;
}

export function streamDecoder(): stream.Transform {
  let buf = Buffer.alloc(0);

  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(chunk, _encoding, cb) {
      try {
        buf = Buffer.concat([buf, chunk]);
        buf = decodeMessages(buf, this);
        cb();
      } catch (e) {
        cb(ensureError(e), null);
      }
    },
  });
}

// Decodes messages from Lambda requests to an array of headers + protocol messages
const base64regex =
  /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;

export function decodeLambdaBody(msgBase64: string): Message[] {
  if (!base64regex.test(msgBase64)) {
    throw new Error(
      "Cannot parse the lambda request body, body was not valid base64 encoded: " +
        msgBase64
    );
  }

  const buf = Buffer.from(msgBase64, "base64");
  const decodedEntries: Message[] = [];

  let trailingData: Buffer;
  try {
    trailingData = decodeMessages(buf, decodedEntries);
  } catch (e) {
    const err = ensureError(e);
    throw new Error(
      "Cannot parse the lambda request body, message was not a valid sequence of Restate messages: " +
        err.message,
      { cause: err }
    );
  }

  if (trailingData.length > 0) {
    throw new Error(
      "Cannot parse the lambda request body: Trailing data (incomplete message) in request body: " +
        trailingData.toString("hex")
    );
  }

  return decodedEntries;
}
