"use strict";

import {
  COMPLETION_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  StartMessage,
  SUSPENSION_MESSAGE_TYPE,
} from "../src/types/protocol";
import { RestateDuplexStream } from "../src/connection/restate_duplex_stream";
import * as restate from "../src/public_api";
import { Connection } from "../src/connection/connection";
import stream from "stream";
import { DurableExecutionStateMachine } from "../src/state_machine";
import { printMessageAsJson } from "../src/utils/utils";
import { Message } from "../src/types/types";
import { HostedGrpcServiceMethod, ProtoMetadata } from "../src/types/grpc";
import { ProtocolMode } from "../src/generated/proto/discovery";
import { rlog } from "../src/utils/logger";

export class TestDriver<I, O> implements Connection {
  private http2stream = this.mockHttp2DuplexStream();
  private restate = RestateDuplexStream.from(this.http2stream);
  private result: Array<Message> = [];

  private restateServer: TestRestateServer;
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
    this.restateServer = new TestRestateServer();
    this.restateServer.bindService({
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
      // First eagerly send the replay messages, then send the completion messages at the end of the task queue (setTimeout)
      if (el.messageType !== COMPLETION_MESSAGE_TYPE) {
        this.desm.onIncomingMessage(el);
      } else {
        // we use set timeout here to add the sending of the messages to the end of the task queue
        setTimeout(() => this.desm.onIncomingMessage(el));
      }
    });

    return this.getResultPromise;
  }

  send(msg: Message) {
    this.result.push(msg);
    rlog.debugExpensive(
      () =>
        `Adding result to the result array. Message type: ${msg.messageType},
        message: 
        ${
          msg.message instanceof Uint8Array
            ? (msg.message as Uint8Array).toString()
            : printMessageAsJson(msg.message)
        }`
    );

    // For an output message, flush immediately
    if (
      msg.messageType === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      msg.messageType === SUSPENSION_MESSAGE_TYPE
    ) {
      rlog.debug("End of test: Flushing test results");
      this.resolveOnClose(this.result);
      this.end();
    }
  }

  onMessage(handler: (msg: Message) => void) {
    this.restate.onMessage(handler);
  }

  onClose(handler: () => void) {
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

/**
 * This class' only purpose is to make certain methods accessible in tests.
 * Those methods are otherwise protected, to reduce the public interface and
 * make it simpler for users to understand what methods are relevant for them,
 * and which ones are not.
 */
class TestRestateServer extends restate.RestateServer {
  public methodByUrl<I, O>(
    url: string | null | undefined
  ): HostedGrpcServiceMethod<I, O> | undefined {
    return super.methodByUrl(url);
  }
}
