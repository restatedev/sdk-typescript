"use strict";

import http2 from "http2";
import {
  RestateDuplexStream,
  RestateDuplexStreamEventHandler,
} from "./protocol_stream";
import { parse as urlparse, Url } from "url";
import { on } from "events";

export interface Connection {

  send(message_type: bigint, message: any, completed?: boolean | undefined, requires_ack?: boolean | undefined): void;

  onMessage(handler: RestateDuplexStreamEventHandler): void;

  onClose(handler: () => void): void;

  end(): void;

}

export class HttpConnection implements Connection {
  constructor(
    readonly connectionId: bigint,
    readonly headers: http2.IncomingHttpHeaders,
    readonly url: Url,
    readonly stream: http2.ServerHttp2Stream,
    readonly restate: RestateDuplexStream
  ) {}

  respond404() {
    this.stream.respond({
      "content-type": "application/octet-stream",
      ":status": 404,
    });
    this.stream.end();
  }

  respondOk() {
    this.stream.respond({
      "content-type": "application/octet-stream",
      ":status": 200,
    });
  }

  send(
    message_type: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.restate.send(message_type, message, completed, requires_ack);
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.restate.onMessage(handler);
  }

  onClose(handler: () => void) {
    this.stream.on("close", handler);
  }

  end() {
    this.stream.end();
  }
}

export class TestConnection implements Connection {

  result: Array<any> = [];

  private onClosePromise: Promise<Array<any>>;
  private resolveOnClose!: (value: Array<any>) => void;

  constructor(
    readonly stream: http2.ServerHttp2Stream,
    readonly restate: RestateDuplexStream
  ) {
    this.onClosePromise = new Promise<Array<any>>((resolve) => {
      this.resolveOnClose = resolve;
    });
  }

  send(
    message_type: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.result.push({message_type: message_type, message: message});
    console.debug("Adding result to the result array. Message type: " + message_type + ", message: " + JSON.stringify(message));
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.restate.onMessage(handler);
  }

  onClose(handler: () => void) {
    this.stream.on("close", handler);
  }

  end() {
    console.log("calling on close")
    this.stream.end();
    this.resolveOnClose(this.result);
  }

  public async getResult(): Promise<Array<any>> {
    return this.onClosePromise;
  }
}

export async function* incomingConnectionAtPort(port: number) {
  const server = http2.createServer();

  server.on("error", (err) => console.error(err));
  server.listen(port);

  let connectionId = BigInt(1);

  for await (const [stream, headers] of on(server, "stream")) {
    const s = stream as http2.ServerHttp2Stream;
    const h = headers as http2.IncomingHttpHeaders;
    const u: Url = urlparse(h[":path"] ?? "/");

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
