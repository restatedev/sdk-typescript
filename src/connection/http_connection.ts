"use strict";

import http2 from "http2";
import { parse as urlparse, Url } from "url";
import { RestateDuplexStream } from "./restate_duplex_stream";
import { ServiceDiscoveryResponse } from "../generated/proto/discovery";
import { on } from "events";
import { Connection } from "./connection";
import { Message } from "../types/types";

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

  send(msg: Message) {
    // Add the message to the result set
    this.restate.send(msg);
  }

  onMessage(handler: (msg: Message) => void) {
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
      console.info(
        "Answering discovery request. Registering these services: " +
          JSON.stringify(discovery.services)
      );
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
