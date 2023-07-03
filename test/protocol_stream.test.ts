import { describe, expect } from "@jest/globals";
import {
  START_MESSAGE_TYPE,
  StartMessage,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol";
import { RestateHttp2Connection } from "../src/connection/http_connection";
import { Header, Message } from "../src/types/types";
import stream from "stream";
import { CompletablePromise } from "../src/utils/utils";

// The following test suite is taken from headers.rs
describe("Header", () => {
  it("Should round trip a custom message", () => {
    const a = new Header(0xfc00n, 10);
    const b = Header.fromU64be(a.toU64be());

    expect(b).toStrictEqual(a);
  });

  it("invoke_test", () => roundtripTest(newStart(1, 25)));

  it("invoke_test_partial_state", () => roundtripTest(newStart(1, 25, true)));
  it("invoke_test_complete_state", () => roundtripTest(newStart(1, 25, undefined)));

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
    // imagine that the HTTP2 request handler hands to you a bidirectional (duplex in node's lingo)
    // binary stream, that you can read from and write to.
    const http2stream = mockHttp2DuplexStream();

    // the following demonstrates how to use a stream_encoder/decoder to convert
    // a raw duplex stream to a high-level stream of Restate's protocol messages and headers.
    const restateStream = RestateHttp2Connection.from(http2stream);

    // here we need to create a promise for the sake of this test.
    // this future will be resolved once something is emitted on the stream.
    const result = new CompletablePromise<Message>();

    restateStream.pipeToConsumer({
      handleMessage: (m) => {
        result.resolve(m);
        return false;
      },

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handleInputClosed: () => {},

      handleStreamError: result.reject,
    });

    // now, let's simulate sending a message
    restateStream.buffer(
      new Message(
        START_MESSAGE_TYPE,
        StartMessage.create({
          invocationId: Buffer.from("abcd"),
          knownEntries: 1337,
        })
      )
    );
    await restateStream.flush();
    restateStream.end();

    // and collect what was written
    const msg = await result.promise;

    expect(msg.messageType).toStrictEqual(START_MESSAGE_TYPE);
    expect((msg.message as StartMessage).knownEntries).toStrictEqual(1337);
  });
});

// The following is taken from headers.rs tests
function newHeader(messageTypeId: bigint, length: number): Header {
  return new Header(messageTypeId, length);
}

function newStart(protocolVersion: number, length: number, partialStateFlag?: boolean): Header {
  return new Header(START_MESSAGE_TYPE, length, undefined, protocolVersion, undefined, partialStateFlag);
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
  sameTruthness(a.partialStateFlag, b.partialStateFlag);
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
