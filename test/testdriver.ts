"use strict";

import { COMPLETION_MESSAGE_TYPE, START_MESSAGE_TYPE, StartMessage } from "../src/types/protocol";
import { RestateHttp2Connection } from "../src/connection/http_connection";
import * as restate from "../src/public_api";
import { Connection } from "../src/connection/connection";
import stream from "stream";
import { printMessageAsJson } from "../src/utils/utils";
import { Message } from "../src/types/types";
import { HostedGrpcServiceMethod } from "../src/types/grpc";
import { ProtocolMode } from "../src/generated/proto/discovery";
import { rlog } from "../src/utils/logger";
import { StateMachine } from "../src/state_machine";
import { InvocationBuilder } from "../src/invocation";
import {LocalStateStore} from "../src/local_state_store";
import {StartMessage_StateEntry} from "../src/generated/proto/protocol";
import { protoMetadata } from "../src/generated/proto/test";

export class TestDriver<I, O> implements Connection {
  private http2stream = this.mockHttp2DuplexStream();
  private restate = RestateHttp2Connection.from(this.http2stream);
  private result: Array<Message> = [];
  private protocolMode = ProtocolMode.BIDI_STREAM;

  private restateServer: TestRestateServer;
  private method: HostedGrpcServiceMethod<I, O>;
  private stateMachine: StateMachine<I, O>;
  private completionMessages: Array<Message>;

  private getResultPromise: Promise<Array<Message>>;
  private resolveOnClose!: (value: Array<Message>) => void;

  constructor(
    instance: object,
    entries: Array<Message>,
    protocolMode?: ProtocolMode,
  ) {
    this.restateServer = new TestRestateServer();
    this.restateServer.bindService({
      descriptor: protoMetadata,
      service: "TestGreeter",
      instance: instance,
    });

    if (protocolMode) {
      this.protocolMode = protocolMode;
    }

    const methodName = "/test.TestGreeter/Greet";

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

    if (entries.length < 2) {
      throw new Error(
        "Less than two runtime messages supplied for test. Need to have at least start message and input message."
      );
    }

    if(entries[0].messageType !== START_MESSAGE_TYPE){
      throw new Error(
        "First message has to be start message."
      );
    }

    // Get the index of where the completion messages start in the entries list
    const firstCompletionIndex = entries.findIndex(
      (value) => value.messageType === COMPLETION_MESSAGE_TYPE
    );

    // The last message of the replay is the one right before the first completion
    const endOfReplay =
      firstCompletionIndex !== -1 ? firstCompletionIndex : entries.length;

    const msg = entries[0];
    // We need to set the right number for known entries. Copy the rest
    const startEntry = msg.message as StartMessage;
    entries[0] = new Message(
      msg.messageType,
      StartMessage.create({
        instanceKey: startEntry.instanceKey,
        invocationId: startEntry.invocationId,
        knownEntries: endOfReplay - 1,
        stateMap: startEntry.stateMap
      }),
      msg.completed,
      msg.protocolVersion,
      msg.requiresAck,
      msg.partialStateFlag
    )

    const replayMessages = entries.slice(0, endOfReplay);
    this.completionMessages = entries.slice(endOfReplay);

    if (
      replayMessages.filter(
        (value) => value.messageType === COMPLETION_MESSAGE_TYPE
      ).length > 0
    ) {
      throw new Error(
        "You cannot interleave replay messages with completion messages. First define the replay messages, then the completion messages."
      );
    }

    if (
      this.completionMessages.filter(
        (value) => value.messageType !== COMPLETION_MESSAGE_TYPE
      ).length > 0
    ) {
      throw new Error(
        "You cannot interleave replay messages with completion messages. First define the replay messages, then the completion messages."
      );
    }

    const invocationBuilder = new InvocationBuilder(this.method);
    replayMessages.forEach(el => invocationBuilder.handleMessage(el))
    const invocation = invocationBuilder.build()

    this.stateMachine = new StateMachine(this, invocation, this.protocolMode);
    this.stateMachine.invoke();
  }

  run(): Promise<Array<Message>> {
    // Pipe messages through the state machine
    this.completionMessages.forEach((el) => {
      setTimeout(() => this.stateMachine.handleMessage(el));
    });
    // Set the input channel to closed a bit after sending the messages
    // to make the service finish up the work it can do and suspend or send back a response.
    setTimeout(() => this.stateMachine.handleInputClosed());

    return this.getResultPromise;
  }

  buffer(msg: Message): void {
    this.result.push(msg);
    rlog.debug(
      `Adding result to the result array. Message type: ${
        msg.messageType
      }, message: 
        ${
          msg.message instanceof Uint8Array
            ? (msg.message as Uint8Array).toString()
            : printMessageAsJson(msg.message)
        }`
    );
  }

  async flush(): Promise<void> {
    return;
  }

  onClose(handler: () => void) {
    this.http2stream.on("close", handler);
  }

  end() {
    this.http2stream.end();
    this.resolveOnClose(this.result);
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
  onError(listener: (e: Error) => void): void {
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
