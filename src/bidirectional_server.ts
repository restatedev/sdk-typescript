"use strict";

import http2 from "http2";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  RestateDuplexStream,
  RestateDuplexStreamEventHandler,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "./protocol_stream";
import { parse as urlparse, Url } from "url";
import { on } from "events";
import {
  Message,
  ProtocolMessage,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
} from "./types";
import { ServiceDiscoveryResponse } from "./generated/proto/discovery";

export interface Connection {
  addOnErrorListener(listener: () => void): void;

  send(
    message_type: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requires_ack?: boolean | undefined
  ): void;

  onMessage(handler: RestateDuplexStreamEventHandler): void;

  onClose(handler: () => void): void;

  end(): void;
}

export class HttpConnection implements Connection {
  private result: Array<Message> = [];
  private onErrorListeners: (() => void)[] = [];

  private requiresCompletion = [
    OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
    INVOKE_ENTRY_MESSAGE_TYPE,
    GET_STATE_ENTRY_MESSAGE_TYPE,
    SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
    AWAKEABLE_ENTRY_MESSAGE_TYPE,
    SLEEP_ENTRY_MESSAGE_TYPE,
  ];

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
    message_type: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.result.push(
      new Message(message_type, message, completed, requires_ack)
    );

    // Only flush the messages if they require a completion.
    if (this.requiresCompletion.includes(message_type)) {
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
          msg.requires_ack
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
