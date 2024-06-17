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

import { describe, expect } from "@jest/globals";
import {
  START_MESSAGE_TYPE,
  StartMessage,
  COMPLETION_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  SetStateEntryMessage,
  SET_STATE_ENTRY_MESSAGE_TYPE,
} from "../src/types/protocol";
import { RestateHttp2Connection } from "../src/connection/http_connection";
import { Header, Message } from "../src/types/types";
import * as stream from "node:stream";
import { setTimeout } from "timers/promises";
import { CompletablePromise } from "../src/utils/promises";

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
    const restateStream = new RestateHttp2Connection({}, http2stream);

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
    restateStream.send(
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
    const { duplex, processBytes } = mockBackpressuredDuplex(8192);
    const connection = new RestateHttp2Connection({}, duplex);

    // enqueue small data, below watermark, so that 'end' can immediately be written
    connection.send(newMessage(10));
    const done = connection.end();

    await verifyPromisePending(done);

    // now let the stream flow
    processBytes(10 * 1024);

    // we should be able to finish cleanly
    await done;
  });

  it("should await sending of larger data when closing", async () => {
    const { duplex, processBytes } = mockBackpressuredDuplex(128);
    const connection = new RestateHttp2Connection({}, duplex);

    // enqueue quite some data, before allowing any bytes to flow any
    connection.send(newMessage(1024));
    connection.send(newMessage(1024));
    connection.send(newMessage(1024));
    const done = connection.end();

    await verifyPromisePending(done);

    // now let the stream flow
    processBytes(10 * 1024);

    // we should be able to finish cleanly
    await done;
  });

  it("should not trigger backpressure for small messages", async () => {
    const { duplex } = mockBackpressuredDuplex(1024);
    const connection = new RestateHttp2Connection({}, duplex);

    // enqueue a message that is too large
    const promise1 = connection.send(newMessage(80));
    const promise2 = connection.send(newMessage(80));

    await verifyPromiseResolved(promise1);
    await verifyPromiseResolved(promise2);
  });

  it("should trigger backpressure for large messages", async () => {
    const { duplex } = mockBackpressuredDuplex(1024);
    const connection = new RestateHttp2Connection({}, duplex);

    // enqueue a message that is too large
    connection.send(newMessage(800));
    const promise2 = connection.send(newMessage(800));

    await verifyPromisePending(promise2);
  });

  it("should resolve backpressure promises when the stream flows", async () => {
    const { duplex, processBytes } = mockBackpressuredDuplex(1024);
    const connection = new RestateHttp2Connection({}, duplex);

    // enqueue a message that is too large
    connection.send(newMessage(800));
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
  promise.finally(() => {
    complete = true;
  });

  await setTimeout(0); // let the callbacks and tasks proceed first

  expect(complete).toBeFalsy();
}

async function verifyPromiseResolved(promise: Promise<unknown>) {
  let complete = false;
  promise.finally(() => {
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

function mockHttp2DuplexStream() {
  const duplex = new stream.Duplex({
    write(chunk, _encoding, next) {
      this.push(chunk);
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    read(_encoding) {
      // don't care.
    },
  });

  // make sure we circuit back the closing of the write side to the read side
  duplex.on("finish", () => {
    duplex.emit("end");
    duplex.emit("close");
  });

  return duplex;
}

function mockBackpressuredDuplex(highWaterMark = 128) {
  let permittedBytes = 0;
  const queue: { bytes: number; cb: () => void }[] = [];

  const duplex = new stream.Duplex({
    highWaterMark,
    write(chunk, _encoding, callback) {
      if (permittedBytes >= chunk.length) {
        permittedBytes -= chunk.length;
        process.nextTick(callback);
      } else {
        queue.push({ bytes: chunk.length - permittedBytes, cb: callback });
        permittedBytes = 0;
      }
    },

    read() {
      // don't care.
    },
  });

  // make sure we circuit back the closing of the write side to the read side
  duplex.on("finish", () => {
    duplex.emit("end");
    duplex.emit("close");
  });

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

  return { duplex, processBytes };
}
