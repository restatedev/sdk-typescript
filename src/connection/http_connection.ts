"use strict";

import http2 from "http2";
import { parse as urlparse, Url } from "url";
import { RestateDuplexStream } from "./restate_duplex_stream";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { on } from "events";
import { Connection } from "./connection";
import { Message } from "../types/types";
import { rlog } from "../utils/logger";
import { InvocationBuilder } from "../invocation";
import { START_MESSAGE_TYPE, StartMessage } from "../types/protocol";
import { StateMachine } from "../state_machine";
import { HostedGrpcServiceMethod } from "../types/grpc";

export class HttpConnection<I, O> implements Connection {
  private onErrorListeners: (() => void)[] = [];
  private _buffer: Message[] = [];
  private invocationBuilder = new InvocationBuilder<I, O>();
  private stateMachine?: StateMachine<I, O>;

  constructor(
    readonly connectionId: bigint,
    readonly headers: http2.IncomingHttpHeaders,
    readonly url: Url,
    readonly stream: http2.ServerHttp2Stream,
    readonly restate: RestateDuplexStream
  ) {
    restate.onError(this.handleConnectionError.bind(this));
    this.restate.onMessage(this.handleMessage.bind(this));
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

  buffer(msg: Message): void {
    this._buffer.push(msg);
  }

  async flush(): Promise<void> {
    if (this._buffer.length == 0) {
      return;
    }
    const buffer = this._buffer;
    this._buffer = [];
    await this.restate.send(buffer);
  }

  handleMessage(m: Message) {
    if (!this.stateMachine) {
      if (m.messageType === START_MESSAGE_TYPE) {
        rlog.debug("Initializing: handling start message.");
        this.invocationBuilder
          .handleStartMessage(m.message as StartMessage)
          .setProtocolMode(ProtocolMode.BIDI_STREAM);
        return;
      } else {
        rlog.debug("Initializing: adding replay message.");
        this.invocationBuilder.addReplayEntry(m);
        if (this.invocationBuilder.isComplete()) {
          rlog.debug("Initialization complete. Creating state machine.");
          this.stateMachine = new StateMachine<I, O>(
            this,
            this.invocationBuilder.build()
          );
          this.stateMachine.invoke();
        }
        return;
      }
    }

    this.stateMachine.handleRuntimeMessage(m);
    return;
  }

  setGrpcMethod(method: HostedGrpcServiceMethod<I, O>) {
    this.invocationBuilder.setGrpcMethod(method);
  }

  handleConnectionError() {
    this.end();
    this.emitOnErrorEvent();
  }

  // We use an error listener to notify the state machine of errors in the connection layer.
  // When there is a connection error (decoding/encoding/...), the statemachine is closed.
  public onError(listener: () => void) {
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
    this.restate.end();
  }
}

export async function* incomingConnectionAtPort(
  port: number,
  discovery: ServiceDiscoveryResponse
) {
  const server = http2.createServer();

  server.on("error", (err) => rlog.error(err));
  server.listen(port);

  let connectionId = BigInt(1);

  for await (const [stream, headers] of on(server, "stream")) {
    const s = stream as http2.ServerHttp2Stream;
    const h = headers as http2.IncomingHttpHeaders;
    const u: Url = urlparse(h[":path"] ?? "/");

    if (u.path == "/discover") {
      rlog.info(
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
