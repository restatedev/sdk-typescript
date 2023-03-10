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
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "./types";

export interface Connection {
  send(
    message_type: bigint,
    message: any,
    completed?: boolean | undefined,
    requires_ack?: boolean | undefined
  ): void;

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
