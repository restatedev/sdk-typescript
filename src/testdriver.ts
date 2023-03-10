"use strict";

import { RestateDuplexStream, StartMessage } from "../src/protocol_stream";
import * as restate from "../src/public_api";
import { Connection } from "../src/bidirectional_server";
import stream from "stream";
import { DurableExecutionStateMachine } from "../src/durable_execution";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  RestateDuplexStreamEventHandler,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "./protocol_stream";
import { SIDE_EFFECT_ENTRY_MESSAGE_TYPE } from "./types";
import { HostedGrpcServiceMethod } from "./core";

export class TestDriver<I, O> implements Connection {
  private http2stream = this.mockHttp2DuplexStream();
  private restate = RestateDuplexStream.from(this.http2stream);
  private result: Array<any> = [];
  private nbRequiredCompletions = 0;
  // For other type of messages that require flushing, check if all test input has finished.
  private requiresCompletion = [
    INVOKE_ENTRY_MESSAGE_TYPE,
    GET_STATE_ENTRY_MESSAGE_TYPE,
    SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
    AWAKEABLE_ENTRY_MESSAGE_TYPE,
    SLEEP_ENTRY_MESSAGE_TYPE,
  ];

  private restateServer: restate.RestateServer;
  private method: HostedGrpcServiceMethod<I, O>;
  private entries: Array<any>;
  private nbCompletions: number;
  private desm!: DurableExecutionStateMachine<I, O>;

  private getResultPromise: Promise<Array<any>>;
  private resolveOnClose!: (value: Array<any>) => void;

  constructor(
    descriptor: any,
    service: string,
    instance: object,
    methodName: string,
    entries: Array<any>
  ) {
    this.restateServer = restate.createServer().bindService({
      descriptor: descriptor,
      service: service,
      instance: instance,
    });

    this.method = this.restateServer.methodByUrl(methodName)!;

    this.getResultPromise = new Promise<Array<any>>((resolve) => {
      this.resolveOnClose = resolve;
    });

    this.entries = entries;
    const nbReplayMessages = this.entries[0].message.knownEntries;
    // number of completions in the entries = length of entries array - one start message - number of replay messages
    this.nbCompletions = this.entries.length - 1 - nbReplayMessages;
  }

  run(): Promise<Array<any>> {
    // is the use of 'this' dangerous here?
    this.desm = new DurableExecutionStateMachine(this, this.method);

    // Pipe messages through the state machine
    this.entries.forEach((el) => {
      this.desm.onIncomingMessage(el.message_type, el.message);
    });

    return this.getResultPromise;
  }

  send(
    message_type: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    completed?: boolean,
    requires_ack?: boolean
  ) {
    this.result.push({ message_type: message_type, message: message });
    console.debug(
      "Adding result to the result array. Message type: " +
        message_type +
        ", message: " +
        JSON.stringify(message)
    );
    console.debug("The full results array currently looks like: ");
    this.result.forEach((el) => console.debug(el));

    // For an output message, flush immediately
    if (message_type === OUTPUT_STREAM_ENTRY_MESSAGE_TYPE) {
      console.debug("End of test: Flushing test results");
      this.resolveOnClose(this.result);
    }

    if (this.requiresCompletion.includes(message_type)) {
      this.nbRequiredCompletions++;
      if (this.nbRequiredCompletions > this.nbCompletions) {
        this.resolveOnClose(this.result);
      } else {
        console.debug(
          `The test input is not yet finished so not yet flushing results.`
        );
      }
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
}
