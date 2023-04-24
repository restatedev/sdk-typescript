"use strict";

import {
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  RestateDuplexStream,
  RestateDuplexStreamEventHandler,
  StartMessage,
  SUSPENSION_MESSAGE_TYPE,
} from "../src/protocol_stream";
import * as restate from "../src/public_api";
import { Connection } from "../src/bidirectional_server";
import stream from "stream";
import { DurableExecutionStateMachine } from "../src/durable_execution";
import {
  Message,
  printMessageAsJson,
  ProtocolMessage,
  ProtoMetadata,
} from "../src/types";
import { HostedGrpcServiceMethod } from "../src/core";
import { ProtocolMode } from "../src/generated/proto/discovery";

export class TestDriver<I, O> implements Connection {
  private http2stream = this.mockHttp2DuplexStream();
  private restate = RestateDuplexStream.from(this.http2stream);
  private result: Array<Message> = [];
  private nbRequiredCompletions = 0;

  private restateServer: restate.RestateServer;
  private protocolMode = ProtocolMode.BIDI_STREAM;
  private method: HostedGrpcServiceMethod<I, O>;
  private entries: Array<Message>;
  private nbCompletions: number;
  private desm!: DurableExecutionStateMachine<I, O>;

  private getResultPromise: Promise<Array<Message>>;
  private resolveOnClose!: (value: Array<Message>) => void;

  constructor(
    descriptor: ProtoMetadata,
    service: string,
    instance: object,
    methodName: string,
    entries: Array<Message>,
    protocolMode?: ProtocolMode
  ) {
    this.restateServer = restate.createServer().bindService({
      descriptor: descriptor,
      service: service,
      instance: instance,
    });

    if (protocolMode) {
      this.protocolMode = protocolMode;
    }

    const hostedGrpcServiceMethod: HostedGrpcServiceMethod<I, O> | undefined =
      this.restateServer.methodByUrl("/invoke" + methodName);

    if (hostedGrpcServiceMethod) {
      this.method = hostedGrpcServiceMethod;
    } else {
      throw new Error("Method not found: " + methodName);
    }

    this.getResultPromise = new Promise<Array<Message>>((resolve) => {
      this.resolveOnClose = resolve;
    });

    this.entries = entries;
    const nbReplayMessages = (this.entries[0].message as StartMessage)
      .knownEntries;
    // number of completions in the entries = length of entries array - one start message - number of replay messages
    this.nbCompletions = this.entries.length - 1 - nbReplayMessages;
  }

  run(): Promise<Array<Message>> {
    this.desm = new DurableExecutionStateMachine(
      this,
      this.method,
      this.protocolMode
    );

    // Pipe messages through the state machine
    this.entries.forEach((el) => {
      this.desm.onIncomingMessage(el.messageType, el.message);
    });

    return this.getResultPromise;
  }

  send(
    message_type: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: ProtocolMessage | Uint8Array,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.result.push(
      new Message(message_type, message, completed, requires_ack)
    );
    console.debug(
      "Adding result to the result array. Message type: " +
        message_type +
        ", message: " +
        printMessageAsJson(message)
    );

    // For an output message, flush immediately
    if (
      message_type === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      message_type === SUSPENSION_MESSAGE_TYPE
    ) {
      console.debug("End of test: Flushing test results");
      this.resolveOnClose(this.result);
    }
  }

  onMessage(handler: RestateDuplexStreamEventHandler) {
    this.restate.onMessage(handler);
  }

  onClose(handler: () => void) {
    console.log("calling onClose");
    this.http2stream.on("close", handler);
  }

  end() {
    this.http2stream.end();
  }

  mockHttp2DuplexStream() {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addOnErrorListener(listener: () => void): void {
    return;
  }
}
