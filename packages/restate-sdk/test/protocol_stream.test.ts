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

import {
  START_MESSAGE_TYPE,
  StartMessage,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol.js";
import { RestateBidiConnection } from "../src/connection/bidi_connection.js";
import { Header, Message } from "../src/types/types.js";
import * as stream from "node:stream/web";
import { setTimeout } from "timers/promises";
import { CompletablePromise } from "../src/utils/promises.js";
import { describe, expect, it } from "vitest";

// The following test suite is taken from headers.rs
describe("Header", () => {
  it("Should round trip a custom message", () => {
    const a = new Header(0xfc00n, 10);
    const b = Header.fromU64be(a.toU64be());

    expect(b).toStrictEqual(a);
  });

  it("invoke_test", () => roundtripTest(newStart(25)));

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
    roundtripTest(new Header(0xfc00n, 10341, undefined, true)));
});

describe("Restate Streaming Connection", () => {
  it("should demonstrate how to write messages and read messages.", async () => {
    // imagine that the HTTP2 request handler hands to you a bidirectional (duplex in node's lingo)
    // binary stream, that you can read from and write to.
    const http2stream = mockHttp2DuplexStream();

    // the following demonstrates how to use a stream_encoder/decoder to convert
    // a raw duplex stream to a high-level stream of Restate's protocol messages and headers.
    const restateStream = new RestateBidiConnection({}, http2stream);

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

      handleStreamError: (error) => result.reject(error),
    });

    // now, let's simulate sending a message
    void restateStream.send(
      new Message(
        START_MESSAGE_TYPE,
        new StartMessage({
          id: Buffer.from("abcd"),
          debugId: "abcd",
          knownEntries: 1337,
        }),
        undefined
      )
    );

    // and collect what was written
    await restateStream.end();
    const msg = await result.promise;

    expect(msg.messageType).toStrictEqual(START_MESSAGE_TYPE);
    expect((msg.message as StartMessage).knownEntries).toStrictEqual(1337);
  });

  it("should await sending of small data when closing", async () => {
    const { duplex, processBytes } = mockBackpressuredDuplex(128);
    const connection = new RestateBidiConnection({}, duplex);

    // enqueue small data, below watermark, so that 'end' can immediately be written
    void connection.send(newMessage(10));
    const done = connection.end();

    await verifyPromisePending(done);

    // now let the stream flow
    processBytes(10 * 1024);

    // we should be able to finish cleanly
    await done;
  });

  it("should await sending of larger data when closing", async () => {
    const { duplex, processBytes } = mockBackpressuredDuplex(128);
    const connection = new RestateBidiConnection({}, duplex);

    // enqueue quite some data, before allowing any bytes to flow any
    void connection.send(newMessage(1024));
    void connection.send(newMessage(1024));
    void connection.send(newMessage(1024));
    const done = connection.end();

    await verifyPromisePending(done);

    // now let the stream flow
    processBytes(10 * 1024);

    // we should be able to finish cleanly
    await done;
  });

  it("should not trigger backpressure for small messages", async () => {
    const { duplex } = mockBackpressuredDuplex(1024);
    const connection = new RestateBidiConnection({}, duplex);

    // enqueue a message that is not too large
    const promise1 = connection.send(newMessage(80));
    const promise2 = connection.send(newMessage(80));

    await verifyPromiseResolved(promise1);
    await verifyPromiseResolved(promise2);
  });

  it("should trigger backpressure for large messages", async () => {
    const { duplex } = mockBackpressuredDuplex(1024);
    const connection = new RestateBidiConnection({}, duplex);

    // this message should get sent immediately because its smaller than 1024
    const promise1 = connection.send(newMessage(800));
    await verifyPromiseResolved(promise1);

    // this one should hang because it takes us over 1024
    const promise2 = connection.send(newMessage(800));
    await verifyPromisePending(promise2);
  });

  it("should resolve backpressure promises when the stream flows", async () => {
    const { duplex, processBytes } = mockBackpressuredDuplex(1024, "flow");
    const connection = new RestateBidiConnection({}, duplex);

    // this message should get sent immediately because its smaller than 1024
    const promise1 = connection.send(newMessage(800));
    await verifyPromiseResolved(promise1);
    // this one should hang until we let it flow because it takes us over 1024
    const promise2 = connection.send(newMessage(800));
    await verifyPromisePending(promise2);

    // now let the stream flow
    processBytes(10 * 1024);

    // this should now complete
    await promise2;
  });
});

// The following is taken from headers.rs tests
function newHeader(messageTypeId: bigint, length: number): Header {
  return new Header(messageTypeId, length);
}

function newStart(length: number): Header {
  return new Header(START_MESSAGE_TYPE, length, undefined, undefined);
}

function newCompletableEntry(
  ty: bigint,
  completed: boolean,
  length: number
): Header {
  return new Header(ty, length, completed);
}

function newMessage(size: number) {
  return new Message(
    SET_STATE_ENTRY_MESSAGE_TYPE,
    new SetStateEntryMessage({
      key: Buffer.from("abcd"),
      value: Buffer.alloc(size),
    })
  );
}

function sameTruthness<A, B>(a: A, b: B) {
  if (a) {
    expect(b).toBeTruthy();
  } else {
    expect(b).toBeFalsy();
  }
}

async function verifyPromisePending(promise: Promise<unknown>) {
  let complete = false;
  void promise.then(() => {
    complete = true;
  });

  await setTimeout(0); // let the callbacks and tasks proceed first

  expect(complete).toBeFalsy();
}

async function verifyPromiseResolved(promise: Promise<unknown>) {
  let complete = false;
  void promise.then(() => {
    complete = true;
  });

  await setTimeout(0); // let the callbacks and tasks proceed first

  expect(complete).toBeTruthy();
}

function roundtripTest(a: Header) {
  const b = Header.fromU64be(a.toU64be());
  expect(b.messageType).toStrictEqual(a.messageType);
  expect(b.frameLength).toStrictEqual(a.frameLength);
  sameTruthness(a.completedFlag, b.completedFlag);
  sameTruthness(a.requiresAckFlag, b.requiresAckFlag);
  sameTruthness(a.partialStateFlag, b.partialStateFlag);
}

function mockHttp2DuplexStream(): stream.ReadableWritablePair<
  Uint8Array,
  Uint8Array
> {
  // pipe output into input
  return new stream.TransformStream();
}

function mockBackpressuredDuplex(highWaterMark: number): {
  duplex: stream.ReadableWritablePair<Uint8Array, Uint8Array>;
  processBytes: (numBytes: number) => void;
} {
  let permittedBytes = 0;
  const queue: { bytes: number; cb: (value: unknown) => void }[] = [];

  const writable = new stream.WritableStream<Uint8Array>(
    {
      write: async (chunk) => {
        if (permittedBytes >= chunk.length) {
          permittedBytes -= chunk.length;
        } else {
          permittedBytes = 0;
          await new Promise((resolve) => {
            queue.push({ bytes: chunk.length - permittedBytes, cb: resolve });
          });
        }
      },
    },
    new stream.ByteLengthQueuingStrategy({ highWaterMark })
  );

  function processBytes(numBytes: number) {
    while (queue.length > 0 && numBytes > 0) {
      const next = queue[0];

      if (next.bytes > numBytes) {
        next.bytes -= numBytes;
        numBytes = 0;
      } else {
        numBytes -= next.bytes;
        queue.pop();
        process.nextTick(next.cb);
      }
    }
    permittedBytes += numBytes;
  }

  return {
    duplex: {
      readable: new stream.ReadableStream(),
      writable,
    },
    processBytes,
  };
}
