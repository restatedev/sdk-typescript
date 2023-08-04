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

                this.push(
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
                this.push(
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
      } catch (e: unknown) {
        cb(e as Error, null);
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
      "Parsing error: SDK cannot parse the message. Message was not valid base64 encoded."
    );
  }

  let buf = Buffer.from(msgBase64, "base64");
  let state = WAITING_FOR_HEADER;
  let header: Header | null = null;
  const decodedEntries: Message[] = [];

  // Will be set to true after parsing the last body.
  let done = false;
  while (!done) {
    switch (state) {
      case WAITING_FOR_HEADER: {
        if (buf.length < 8) {
          throw new Error(
            "Parsing error: SDK cannot parse the message. Buffer was not empty but was too small to contain another header."
          );
        }
        const h = buf.readBigUInt64BE();
        buf = buf.subarray(8);
        header = Header.fromU64be(h);
        state = WAITING_FOR_BODY;
        break;
      }
      case WAITING_FOR_BODY: {
        if (header == null) {
          throw new Error(
            "Parsing error: SDK cannot parse the message. " +
              "Parsing body, while header was not parsed yet"
          );
        }
        if (buf.length < header.frameLength) {
          throw new Error(
            "Parsing error: SDK cannot parse the message. " +
              `Buffer length (${buf.length}) is smaller than frame length (${header.frameLength})`
          );
        }
        const frame = buf.subarray(0, header.frameLength);
        buf = buf.subarray(header.frameLength);

        const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.messageType);
        if (pbType === undefined) {
          // this is a custom message.
          // we don't know how to decode custom message
          // so we let the user of this stream to deal with custom
          // message serde
          decodedEntries.push(
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
          decodedEntries.push(
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

        // Reset the state and the header, to start parsing the next msg
        state = WAITING_FOR_HEADER;
        header = null;

        // After parsing a body we check if there are still bytes left in the buffer,
        // if there are no more bytes left, then we set done to true
        // We cannot simply do while(buf.length > 0) because the body can be empty (e.g. inputRequest = Empty.create())
        // This would have the effect that this loop is stopped after parsing the header that belongs to the empty body.
        // And last message with the empty body will never be added to the decodedEntries.
        if(buf.length === 0){
          done = true;
        }
      }
    }
  }
  return decodedEntries;
}
