"use strict";

import http2 from "http2";
import {
  MESSAGES_REQUIRING_COMPLETION,
  MESSAGES_TRIGGERING_SUSPENSION,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  RestateDuplexStream,
  RestateDuplexStreamEventHandler,
  SUSPENSION_MESSAGE_TYPE,
  SuspensionMessage,
} from "./protocol_stream";
import { parse as urlparse, Url } from "url";
import { on } from "events";
import { Message, ProtocolMessage } from "./types";
import { ServiceDiscoveryResponse } from "./generated/proto/discovery";

export interface Connection {
  addOnErrorListener(listener: () => void): void;

  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requiresAck?: boolean | undefined,
    completableIndices?: number[] | undefined
  ): void;

  onMessage(handler: RestateDuplexStreamEventHandler): void;

  onClose(handler: () => void): void;

  end(): void;
}

export class HttpConnection implements Connection {
  private result: Array<Message> = [];
  private onErrorListeners: (() => void)[] = [];

  constructor(
    readonly connectionId: bigint,
    readonly headers: http2.IncomingHttpHeaders,
    readonly url: Url,
    readonly stream: http2.ServerHttp2Stream,
    readonly restate: RestateDuplexStream
  ) {
    restate.onError(this.onError.bind(this));
  }

  respond404() {
    this.stream.respond({
      "content-type": "application/restate",
      ":status": 404,
    });
    this.stream.end();
  }

  respondOk() {
    this.stream.respond({
      "content-type": "application/restate",
      ":status": 200,
    });
  }

  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requiresAck?: boolean | undefined,
    completableIndices?: number[] | undefined
  ) {
    // Add the message to the result set
    this.result.push(new Message(messageType, message, completed, requiresAck));

    // If the messages require a completion, then flush.
    if (MESSAGES_REQUIRING_COMPLETION.includes(messageType)) {
      // If the message leads to a suspension, then add a suspension message before the flush.
      if (MESSAGES_TRIGGERING_SUSPENSION.includes(messageType)) {
        if (completableIndices == undefined) {
          throw new Error(
            "Invocation requires completion but no completable entry indices known."
          );
        }
        const suspensionMsg = SuspensionMessage.create({
          entryIndexes: completableIndices,
        });
        this.result.push(
          new Message(SUSPENSION_MESSAGE_TYPE, suspensionMsg, false, false)
        );
      }

      this.flush();
    }

    // If we have a response for the invocation, flush.
    if (messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE) {
      this.flush();
    }
  }

  flush() {
    this.result.forEach((msg) => {
      try {
        this.restate.send(
          msg.messageType,
          msg.message,
          msg.completed,
          msg.requiresAck
        );
      } catch (e) {
        console.warn(e);
        console.log("Closing the connection and state machine.");
        this.end();
      }
    });
    this.result = [];
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.restate.onMessage(handler);
  }

  onError() {
    this.end();
    this.emitOnErrorEvent();
  }

  // We use an error listener to notify the state machine of errors in the connection layer.
  // When there is a connection error (decoding/encoding/...), the statemachine is closed.
  public addOnErrorListener(listener: () => void) {
    this.onErrorListeners.push(listener);
  }

  private emitOnErrorEvent() {
    for (const listener of this.onErrorListeners) {
      listener();
    }
  }

  onClose(handler: () => void) {
    this.stream.on("close", handler);
  }

  end() {
    console.log("Closing the connection...");
    this.stream.end();
  }
}

export async function* incomingConnectionAtPort(
  port: number,
  discovery: ServiceDiscoveryResponse
) {
  const server = http2.createServer();

  server.on("error", (err) => console.error(err));
  server.listen(port);

  let connectionId = BigInt(1);

  for await (const [stream, headers] of on(server, "stream")) {
    const s = stream as http2.ServerHttp2Stream;
    const h = headers as http2.IncomingHttpHeaders;
    const u: Url = urlparse(h[":path"] ?? "/");

    if (u.path == "/discover") {
      s.respond({
        ":status": 200,
        "content-type": "application/proto",
      });
      s.write(ServiceDiscoveryResponse.encode(discovery).finish());
      s.end();
      continue;
    }

    connectionId += 1n;
    const connection = new HttpConnection(
      connectionId,
      h,
      u,
      s,
      RestateDuplexStream.from(s)
    );

    yield connection;
  }
}
