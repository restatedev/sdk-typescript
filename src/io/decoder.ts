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
import { Header } from "../types/types";

const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

export function streamDecoder(): stream.Transform {
  let buf = Buffer.alloc(0);
  let state = WAITING_FOR_HEADER;
  let header: Header;

  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(chunk, _encoding, cb) {
      try {
        buf = Buffer.concat([buf, chunk]);
        // eslint-disable-next-line no-constant-condition
        while (true) {
          switch (state) {
            case WAITING_FOR_HEADER: {
              if (buf.length < 8) {
                cb();
                return;
              }
              const h = buf.readBigUInt64BE();
              buf = buf.subarray(8);
              header = Header.fromU64be(h);
              state = WAITING_FOR_BODY;
              break;
            }
            case WAITING_FOR_BODY: {
              if (buf.length < header.frameLength) {
                cb();
                return;
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
                this.push({ header: header, message: frame });
              } else {
                const message = pbType.decode(frame);
                this.push({ header: header, message: message });
              }
              break;
            }
          }
        }
      } catch (e: unknown) {
        cb(e as Error, null);
      }
    },
  });
}
