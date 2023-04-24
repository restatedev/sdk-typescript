"use strict";

import http2 from "http2";
import {
  RestateDuplexStream,
  RestateDuplexStreamEventHandler,
} from "./protocol_stream";
import { parse as urlparse, Url } from "url";
import { on } from "events";
import { ProtocolMessage } from "./types";
import { ServiceDiscoveryResponse } from "./generated/proto/discovery";

export interface Connection {
  addOnErrorListener(listener: () => void): void;

  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requiresAck?: boolean | undefined
  ): void;

  onMessage(handler: RestateDuplexStreamEventHandler): void;

  onClose(handler: () => void): void;

  end(): void;
}

export class HttpConnection implements Connection {
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
    requiresAck?: boolean | undefined
  ) {
    // Add the message to the result set
    this.restate.send(messageType, message, completed, requiresAck);
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
