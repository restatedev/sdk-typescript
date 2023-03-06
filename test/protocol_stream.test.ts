import { describe, expect } from "@jest/globals";
import {
  Header,
  START_MESSAGE_TYPE,
  StartMessage,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  RestateDuplexStream,
} from "../src/protocol_stream";
import stream from "stream";


// The following test suite is taken from headers.rs
describe("Header", () => {
  it("Should round trip a custom message", () => {
    const a = new Header(0xfc00n, 10);
    const b = Header.from_u64be(a.to_u64be());

    expect(b).toStrictEqual(a);
  });

  it("invoke_test", () => roundtrip_test(new_start(1, 25)));

  it("completion_test", () =>
    roundtrip_test(new_header(COMPLETION_MESSAGE_TYPE, 22)));

  it("completed_get_state", () =>
    roundtrip_test(
      new_completable_entry(GET_STATE_ENTRY_MESSAGE_TYPE, true, 0)
    ));

  it("not_completed_get_state", () =>
    roundtrip_test(
      new_completable_entry(GET_STATE_ENTRY_MESSAGE_TYPE, false, 0)
    ));

  it("completed_get_state_with_len", () =>
    roundtrip_test(
      new_completable_entry(GET_STATE_ENTRY_MESSAGE_TYPE, true, 10341)
    ));

  it("custom_entry", () => roundtrip_test(new_header(0xfc00n, 10341)));

  it("custom_entry_with_requires_ack", () =>
    roundtrip_test(new Header(0xfc00n, 10341, undefined, undefined, true)));
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
      restateStream.onMessage((message, message_type) => {
        resolve({ message, message_type });
      });
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
    const { message, message_type } = await result;

    expect(message_type).toStrictEqual(START_MESSAGE_TYPE);
    expect(message.knownEntries).toStrictEqual(1337);
  });
});

// The following is taken from headers.rs tests
function new_header(message_type_id: bigint, length: number): Header {
  return new Header(message_type_id, length);
}

function new_start(protocol_version: number, length: number): Header {
  return new Header(START_MESSAGE_TYPE, length, undefined, protocol_version);
}

function new_completable_entry(
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

function roundtrip_test(a: Header) {
  const b = Header.from_u64be(a.to_u64be());
  expect(b.message_type).toStrictEqual(a.message_type);
  expect(b.frame_length).toStrictEqual(a.frame_length);
  expect(b.protocol_version).toStrictEqual(a.protocol_version);
  sameTruthness(a.completed_flag, b.completed_flag);
  sameTruthness(a.requires_ack_flag, b.requires_ack_flag);
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
