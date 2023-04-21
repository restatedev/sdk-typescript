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
  SuspensionMessage,
} from "./generated/proto/protocol";
import { ProtocolMessage } from "./types";

// Re-export the protobuf messages.
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
  SuspensionMessage,
} from "./generated/proto/protocol";

// Export the protocol message types as defined by the restate protocol.
export const START_MESSAGE_TYPE = 0x0000n;
export const COMPLETION_MESSAGE_TYPE = 0x0001n;
export const SUSPENSION_MESSAGE_TYPE = 0x0002n;
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

// Restate DuplexStream
export type RestateDuplexStreamEventHandler = (
  messageType: bigint,
  message: ProtocolMessage | Uint8Array,
  completedFlag?: boolean,
  protocolVersion?: number,
  requiresAckFlag?: boolean
) => void;

export type RestateDuplexStreamErrorHandler = (err: Error) => void;

export class RestateDuplexStream {
  // create a RestateDuplex stream from an http2 (duplex) stream.
  public static from(http2stream: stream.Duplex): RestateDuplexStream {
    const sdkInput = http2stream.pipe(streamDecoder());

    const sdkOutput = streamEncoder();
    sdkOutput.pipe(http2stream);

    return new RestateDuplexStream(sdkInput, sdkOutput);
  }

  constructor(
    private readonly sdkInput: stream.Readable,
    private readonly sdkOutput: stream.Writable
  ) {}

  send(
    messageType: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: ProtocolMessage | Uint8Array,
    completed?: boolean,
    requiresAck?: boolean
  ) {
    this.sdkOutput.write({
      messageType: messageType,
      message,
      completed,
      requiresAck: requiresAck,
    });
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.sdkInput.on("data", (data) => {
      const { header, message } = data;
      const h = header as Header;
      handler(
        h.messageType,
        message,
        h.completedFlag,
        h.protocolVersion,
        h.requiresAckFlag
      );
    });
  }

  onError(handler: RestateDuplexStreamErrorHandler) {
    this.sdkInput.on("error", (err) => {
      console.warn("Error in input stream: " + err.stack);
      handler(err);
    });
  }
}

// Message types in the protocol.
// Custom message types (per SDK) such as side effect entry message should not be included here.
const KNOWN_MESSAGE_TYPES = new Set([
  START_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
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
  [SUSPENSION_MESSAGE_TYPE, SuspensionMessage],
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

// These message types require a completion from the runtime.
// For request-response these types also require a suspension
export const MESSAGES_REQUIRING_COMPLETION = [
  INVOKE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
];

// On these message types, the invocation will be suspended
export const MESSAGES_TRIGGERING_SUSPENSION = [
  INVOKE_ENTRY_MESSAGE_TYPE,
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
];

const CUSTOM_MESSAGE_MASK = BigInt(0xfc00);
const COMPLETED_MASK = BigInt(0x0001_0000_0000);
const VERSION_MASK = BigInt(0x03ff_0000_0000);
const REQUIRES_ACK_MASK = BigInt(0x0001_0000_0000);

class MessageType {
  static assertValid(messageTypeId: bigint) {
    if (KNOWN_MESSAGE_TYPES.has(messageTypeId)) {
      return;
    }
    if ((messageTypeId & CUSTOM_MESSAGE_MASK) !== 0n) {
      return;
    }
    throw new Error(`Unknown message type ${messageTypeId}`);
  }

  static hasCompletedFlag(messageType: bigint): boolean {
    return (
      messageType === POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      messageType === GET_STATE_ENTRY_MESSAGE_TYPE ||
      messageType === SLEEP_ENTRY_MESSAGE_TYPE ||
      messageType === AWAKEABLE_ENTRY_MESSAGE_TYPE
    );
  }

  static hasProtocolVersion(messageType: bigint): boolean {
    return messageType == START_MESSAGE_TYPE;
  }

  static isCustom(messageTypeId: bigint): boolean {
    return !KNOWN_MESSAGE_TYPES.has(messageTypeId);
  }

  static hasRequiresAckFlag(messageTypeId: bigint): boolean {
    return this.isCustom(messageTypeId);
  }
}

// The header is exported but only for tests.
export class Header {
  constructor(
    readonly messageType: bigint,
    readonly frameLength: number,
    readonly completedFlag?: boolean,
    readonly protocolVersion?: number,
    readonly requiresAckFlag?: boolean
  ) {}

  public static fromU64be(value: bigint): Header {
    const tyCode: bigint = (value >> 48n) & 0xffffn;
    MessageType.assertValid(tyCode);

    const completedFlag =
      MessageType.hasCompletedFlag(tyCode) && (value & COMPLETED_MASK) !== 0n
        ? true
        : undefined;
    const protocolVersion = MessageType.hasProtocolVersion(tyCode)
      ? Number(((value & VERSION_MASK) >> 32n) & 0xffffn)
      : undefined;
    const requiresAckFlag =
      MessageType.hasRequiresAckFlag(tyCode) &&
      (value & REQUIRES_ACK_MASK) !== 0n
        ? true
        : undefined;
    const frameLength = Number(value & 0xffffffffn);

    return new Header(
      tyCode,
      frameLength,
      completedFlag,
      protocolVersion,
      requiresAckFlag
    );
  }

  public toU64be(): bigint {
    let res = (this.messageType << 48n) | BigInt(this.frameLength);
    if (this.completedFlag) {
      res = res | COMPLETED_MASK;
    }
    if (this.protocolVersion !== undefined) {
      res = res | (BigInt(this.protocolVersion) << 32n);
    }
    if (this.requiresAckFlag) {
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
// let decodedStream = stream.pipe(streamDecoder());
//
// at this point the decodedStream is a high level stream of objects {header, message}
const WAITING_FOR_HEADER = 0;
const WAITING_FOR_BODY = 1;

function streamDecoder(): stream.Transform {
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
function streamEncoder(): stream.Transform {
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

interface EncoderOpts {
  messageType: bigint;
  message: ProtocolMessage | Uint8Array;
  version?: number;
  completed?: boolean;
  requiresAck?: boolean;
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

export class InputEntry {
  constructor(
    readonly header: Header,
    readonly message: ProtocolMessage | Buffer
  ) {}
}
