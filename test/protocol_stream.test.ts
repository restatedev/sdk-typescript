import { describe, expect } from "@jest/globals";
import {
  START_MESSAGE_TYPE,
  StartMessage,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol";
import { RestateDuplexStream } from "../src/connection/restate_duplex_stream";
import { Header } from "../src/types/types";
import stream from "stream";

// The following test suite is taken from headers.rs
describe("Header", () => {
  it("Should round trip a custom message", () => {
    const a = new Header(0xfc00n, 10);
    const b = Header.fromU64be(a.toU64be());

    expect(b).toStrictEqual(a);
  });

  it("invoke_test", () => roundtripTest(newStart(1, 25)));

  it("completion_test", () =>
    roundtripTest(newHeader(COMPLETION_MESSAGE_TYPE, 22)));

  it("completed_get_state", () =>
    roundtripTest(newCompletableEntry(GET_STATE_ENTRY_MESSAGE_TYPE, true, 0)));

  it("not_completed_get_state", () =>
    roundtripTest(newCompletableEntry(GET_STATE_ENTRY_MESSAGE_TYPE, false, 0)));

  it("completed_get_state_with_len", () =>
    roundtripTest(
      newCompletableEntry(GET_STATE_ENTRY_MESSAGE_TYPE, true, 10341)
    ));

  it("custom_entry", () => roundtripTest(newHeader(0xfc00n, 10341)));

  it("custom_entry_with_requires_ack", () =>
    roundtripTest(new Header(0xfc00n, 10341, undefined, undefined, true)));
});

describe("Stream", () => {
  it("should demonstrate how an SDK can use encoder/decoder.", async () => {
    // imagine that the HTTP2 request handler hands to you a bi-directional (duplex in node's lingo)
    // binary stream, that you can read from and write to.
    const http2stream = mockHttp2DuplexStream();

    // the following demonstrate how to use a stream_encoder/decoder to convert
    // a raw duplex stream to a highlevel stream of restate's protocol messages and headers.
    const restateStream = RestateDuplexStream.from(http2stream);

    // the following commented lines are how you would actually use it
    // but in a test we need to await the result.
    //
    //  restateStream.onMessage((header, message) => {
    //      // do something with this message
    //  });
    //

    // here we need to create a promise for the sake of this test.
    // this future will be resolved onces something is emmited on the stream.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = new Promise((resolve) => {
      restateStream.onMessage(
        (
          messageType,
          message,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          completedFlag,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          protocolVersion,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          requiresAckFlag
        ) => {
          resolve({ messageType: messageType, message });
        }
      );
    });

    // now, lets simulate sending a message
    restateStream.send(
      START_MESSAGE_TYPE,
      StartMessage.create({
        invocationId: Buffer.from("abcd"),
        knownEntries: 1337,
      })
    );

    http2stream.end();

    // and collect what was written
    const { message, messageType: messageType } = await result;

    expect(messageType).toStrictEqual(START_MESSAGE_TYPE);
    expect(message.knownEntries).toStrictEqual(1337);
  });
});

// The following is taken from headers.rs tests
function newHeader(messageTypeId: bigint, length: number): Header {
  return new Header(messageTypeId, length);
}

function newStart(protocolVersion: number, length: number): Header {
  return new Header(START_MESSAGE_TYPE, length, undefined, protocolVersion);
}

function newCompletableEntry(
  ty: bigint,
  completed: boolean,
  length: number
): Header {
  return new Header(ty, length, completed);
}

function sameTruthness<A, B>(a: A, b: B) {
  if (a) {
    expect(b).toBeTruthy();
  } else {
    expect(b).toBeFalsy();
  }
}

function roundtripTest(a: Header) {
  const b = Header.fromU64be(a.toU64be());
  expect(b.messageType).toStrictEqual(a.messageType);
  expect(b.frameLength).toStrictEqual(a.frameLength);
  expect(b.protocolVersion).toStrictEqual(a.protocolVersion);
  sameTruthness(a.completedFlag, b.completedFlag);
  sameTruthness(a.requiresAckFlag, b.requiresAckFlag);
}

function mockHttp2DuplexStream() {
  return new stream.Duplex({
    write(chunk, _encoding, next) {
      this.push(chunk);
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    read(_encoding) {
      // don't care.
    },
  });
}
