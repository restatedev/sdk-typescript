"use strict";

import stream from "stream";

import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  PollInputStreamEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
} from "./generated/proto/protocol";
import { ProtocolMessage } from "./types";

// --- public api

// 1. re-export the protobuf messages.

export {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  CompletionMessage,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  PollInputStreamEntryMessage,
  SetStateEntryMessage,
  SleepEntryMessage,
  StartMessage,
} from "./generated/proto/protocol";

// 2. export the protocol message types as defined by the restate protocol.

export const START_MESSAGE_TYPE = 0x0000n;
export const COMPLETION_MESSAGE_TYPE = 0x0001n;
export const POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE = 0x0400n;
export const OUTPUT_STREAM_ENTRY_MESSAGE_TYPE = 0x0401n;
export const GET_STATE_ENTRY_MESSAGE_TYPE = 0x0800n;
export const SET_STATE_ENTRY_MESSAGE_TYPE = 0x0801n;
export const CLEAR_STATE_ENTRY_MESSAGE_TYPE = 0x0802n;
export const SLEEP_ENTRY_MESSAGE_TYPE = 0x0c00n;
export const INVOKE_ENTRY_MESSAGE_TYPE = 0x0c01n;
export const BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE = 0x0c02n;
export const AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c03n;
export const COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE = 0x0c04n;
// Side effect message type for Typescript SDK
// Side effects are custom messages because the runtime does not need to inspect them
export const SIDE_EFFECT_ENTRY_MESSAGE_TYPE = 0xfc01n;

// 3. restate DuplexStream.
// TODO: docs.
export type RestateDuplexStreamEventHandler = (
  message_type: bigint,
  message: ProtocolMessage | Uint8Array,
  completed_flag?: boolean,
  protocol_version?: number,
  requires_ack_flag?: boolean
) => void;

export class RestateDuplexStream {
  // create a RestateDuplex stream from an http2 (duplex) stream.
  public static from(http2stream: stream.Duplex): RestateDuplexStream {
    const sdkInput = http2stream.pipe(stream_decoder());
    const sdkOutput = stream_encoder();
    sdkOutput.pipe(http2stream);

    return new RestateDuplexStream(sdkInput, sdkOutput);
  }

  constructor(
    private readonly sdkInput: stream.Readable,
    private readonly sdkOutput: stream.Writable
  ) {}

  send(
    message_type: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: ProtocolMessage | Uint8Array,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.sdkOutput.write({
      message_type,
      message,
      completed,
      requires_ack,
    });
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.sdkInput.on("data", (data) => {
      const { header, message } = data;
      const h = header as Header;
      handler(
        h.message_type,
        message,
        h.completed_flag,
        h.protocol_version,
        h.requires_ack_flag
      );
    });
  }
}

// --------------------------------------------------------------------------------------------------
// implemention details.
//
// The, following section is about parsing a Header. A Header is encoded as a Big endian 64 bit value,
// with various masked sections. It is not yet well documented, the the code below is my attempt to reverse
// eng the encoding and decoding.
//
// TODO: Add some test data to verify this.
//
// The good news are that you don't have to work with headers directly, and they are used in stream_encoder and stream_decoder below,
// to parse/encode frames as they are coming from the restate runtime, and sent back.
// to is somewhat similar to Netty's pipelines that transform a chunked stream of ByteBufs to high level objects (and back).
//
// NOTE: in JavaScript native numbers have 53 bits, so we need to use BigInts here.
//
// source: header.rs in the restate repo.
//
// --------------------------------------------------------------------------------------------------

const KNOWN_MESSAGE_TYPES = new Set([
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROTOBUF_MESSAGES: Array<[bigint, any]> = [
  [START_MESSAGE_TYPE, StartMessage],
  [COMPLETION_MESSAGE_TYPE, CompletionMessage],
  [POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE, PollInputStreamEntryMessage],
  [OUTPUT_STREAM_ENTRY_MESSAGE_TYPE, OutputStreamEntryMessage],
  [GET_STATE_ENTRY_MESSAGE_TYPE, GetStateEntryMessage],
  [SET_STATE_ENTRY_MESSAGE_TYPE, SetStateEntryMessage],
  [CLEAR_STATE_ENTRY_MESSAGE_TYPE, ClearStateEntryMessage],
  [SLEEP_ENTRY_MESSAGE_TYPE, SleepEntryMessage],
  [INVOKE_ENTRY_MESSAGE_TYPE, InvokeEntryMessage],
  [BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, BackgroundInvokeEntryMessage],
  [AWAKEABLE_ENTRY_MESSAGE_TYPE, AwakeableEntryMessage],
  [COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE, CompleteAwakeableEntryMessage],
];

export const PROTOBUF_MESSAGE_BY_TYPE = new Map(PROTOBUF_MESSAGES);

const CUSTOM_MESSAGE_MASK = BigInt(0xfc00);
const COMPLETED_MASK = BigInt(0x0001_0000_0000);
const VERSION_MASK = BigInt(0x03ff_0000_0000);
const REQUIRES_ACK_MASK = BigInt(0x0001_0000_0000);

class MessageType {
  static assert_valid(message_type_id: bigint) {
    if (KNOWN_MESSAGE_TYPES.has(message_type_id)) {
      return;
    }
    if ((message_type_id & CUSTOM_MESSAGE_MASK) !== 0n) {
      return;
    }
    throw new Error(`Unknown message type ${message_type_id}`);
  }

  static has_completed_flag(message_type: bigint): boolean {
    return (
      message_type === POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      message_type === GET_STATE_ENTRY_MESSAGE_TYPE ||
      message_type === SLEEP_ENTRY_MESSAGE_TYPE ||
      message_type === AWAKEABLE_ENTRY_MESSAGE_TYPE
    );
  }

  static has_protocol_version(message_type: bigint): boolean {
    return message_type == START_MESSAGE_TYPE;
  }

  static is_custom(message_type_id: bigint): boolean {
    return !KNOWN_MESSAGE_TYPES.has(message_type_id);
  }

  static has_requires_ack_flag(message_type_id: bigint): boolean {
    return this.is_custom(message_type_id);
  }
}

// The header is exported but only for tests.
export class Header {
  constructor(
    readonly message_type: bigint,
    readonly frame_length: number,
    readonly completed_flag?: boolean,
    readonly protocol_version?: number,
    readonly requires_ack_flag?: boolean
  ) {}

  public static from_u64be(value: bigint): Header {
    const ty_code: bigint = (value >> 48n) & 0xffffn;
    MessageType.assert_valid(ty_code);

    const completed_flag =
      MessageType.has_completed_flag(ty_code) && (value & COMPLETED_MASK) !== 0n
        ? true
        : undefined;
    const protocol_version = MessageType.has_protocol_version(ty_code)
      ? Number(((value & VERSION_MASK) >> 32n) & 0xffffn)
      : undefined;
    const requires_ack_flag =
      MessageType.has_requires_ack_flag(ty_code) &&
      (value & REQUIRES_ACK_MASK) !== 0n
        ? true
        : undefined;
    const frame_length = Number(value & 0xffffffffn);

    return new Header(
      ty_code,
      frame_length,
      completed_flag,
      protocol_version,
      requires_ack_flag
    );
  }

  public to_u64be(): bigint {
    let res = (this.message_type << 48n) | BigInt(this.frame_length);
    if (this.completed_flag) {
      res = res | COMPLETED_MASK;
    }
    if (this.protocol_version !== undefined) {
      res = res | (BigInt(this.protocol_version) << 32n);
    }
    if (this.requires_ack_flag) {
      res = res | REQUIRES_ACK_MASK;
    }
    return res;
  }
}

// This is a NodeJs stream transformer. It is used to convert a chunked stream of bytes to
// a stream of JavaScript objects of the form { header: .. , message: ..} where:
// * header has some information about the frame like, the message type, and some flags.
// * message is the Protobuf decoded message.
//
// To use this one would need to do the following:
//
// let decoded_stream = stream.pipe(stream_decoder());
//
// at this point the decoded_stream is a high level stream of objects {header, message}
const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

function stream_decoder(): stream.Transform {
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
              const h = buf.readBigUint64BE();
              buf = buf.subarray(8);
              header = Header.from_u64be(h);
              state = WAITING_FOR_BODY;
              break;
            }
            case WAITING_FOR_BODY: {
              if (buf.length < header.frame_length) {
                cb();
                return;
              }
              const frame = buf.subarray(0, header.frame_length);
              buf = buf.subarray(header.frame_length);
              state = WAITING_FOR_HEADER;

              const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(header.message_type);
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

// Same as the stream_decoder but this time to convert from a high level stream of objects
// of the type { header: headerOpts , message: message} to a raw stream of bytes.
// * headerOpts is a dictonary, can be the empty dict {} and it might contain the following keys
//      - ty
//      - version
//      - ack
//      - completed
//   I'm not sure what any of these mean, onces we'll figure out the protocol details we will use these, but for now
//   and empty object {} works just fine, this stream transformer will create a proper header just fine.
//
// * message is a Protobuf message.
function stream_encoder(): stream.Transform {
  return new stream.Transform({
    writableObjectMode: true,
    objectMode: true,

    transform(chunk, _encoding, cb) {
      try {
        const result = encode_message(chunk);
        cb(null, result);
      } catch (e: unknown) {
        cb(e as Error, null);
      }
    },
  });
}

interface EncoderOpts {
  message_type: bigint;
  message: ProtocolMessage | Buffer;
  version?: number;
  completed?: boolean;
  requires_ack?: boolean;
}

function encode_message({
  message_type,
  message,
  version,
  completed,
  requires_ack,
}: EncoderOpts): Uint8Array {
  const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(BigInt(message_type));
  let bodyBuf;
  if (pbType === undefined) {
    // this is a custom message.
    // in this case we expect it to be already encoded.
    bodyBuf = message as Uint8Array;
  } else {
    bodyBuf = pbType.encode(message).finish();
  }
  const header = new Header(
    BigInt(message_type),
    bodyBuf.length,
    completed,
    version,
    requires_ack
  );
  const headerBuf = Buffer.alloc(8);
  const encoded = header.to_u64be();
  headerBuf.writeBigUInt64BE(encoded);
  return Buffer.concat([headerBuf, bodyBuf]);
}
