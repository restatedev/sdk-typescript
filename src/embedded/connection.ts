/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { encodeMessages } from "../io/encoder";
import { decodeMessagesBuffer } from "../io/decoder";
import { Connection } from "../connection/connection";
import { Message } from "../types/types";
import {
  GetResultResponse,
  RemoteContext,
  RemoteContextClientImpl,
} from "../generated/proto/services";
import { InvocationBuilder } from "../invocation";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { StateMachine } from "../state_machine";
import { ProtocolMode } from "../generated/proto/discovery";

const RESOLVED: Promise<void> = Promise.resolve();

class RequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText?: string
  ) {
    super(`${status} ${statusText ?? ""}`);
  }

  precondtionFailed(): boolean {
    return this.status === 412;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function fetch(url: string, req: object): Promise<any>;

function bufConnectRemoteContext(url: string): RemoteContext {
  const client = new RemoteContextClientImpl({
    request: async (
      service: string,
      method: string,
      data: Uint8Array
    ): Promise<Uint8Array> => {
      const req = {
        method: "POST",
        headers: {
          "Content-Type": "application/proto",
          "Content-Length": `${data.length}`,
        },
        body: data,
      };
      const fullUrl = `${url}/${service}/${method}`;
      const res = await fetch(fullUrl, req);

      if (!res.ok) {
        const { status, statusText } = res;
        throw new RequestError(fullUrl, status, statusText);
      }
      const buf = await res.arrayBuffer();
      return Buffer.from(buf);
    },
  });

  return client;
}

class OutboundConnection implements Connection {
  private queue: Message[] = [];
  private tail: Promise<void> = RESOLVED;

  constructor(
    private readonly operationId: string,
    private readonly streamId: string,
    private readonly remote: RemoteContext
  ) {}

  send(msg: Message): Promise<void> {
    return this.enqueue(msg);
  }

  end(): Promise<void> {
    this.tail = this.tail.then(() => this.flush());
    return this.tail;
  }

  private enqueue(request: Message): Promise<void> {
    this.queue.push(request);
    this.tail = this.tail.then(() => this.flush());
    return this.tail;
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return RESOLVED;
    }
    const buffer = encodeMessages(this.queue) as Buffer;
    this.queue = [];

    const res = await this.remote.send({
      operationId: this.operationId,
      streamId: this.streamId,
      messages: buffer,
    });

    if (!res.ok) {
      throw new Error("error connecting to restate");
    }
    if (res.invalidStream !== undefined) {
      throw new Error("fenced off");
    }
  }
}

function unwrap<O>(response: GetResultResponse): O {
  if (response.success === undefined) {
    throw new Error(response.failure?.message ?? "");
  }
  return JSON.parse(response.success.toString()) as O;
}

export async function go<I, O>(
  url: string,
  operationId: string,
  streamId: string,
  method: HostedGrpcServiceMethod<I, O>,
  input: I
): Promise<O> {
  const remote = bufConnectRemoteContext(url);

  // 1. ask to Start this execution.
  //
  //

  const res = await remote.start({
    operationId,
    streamId,
    retentionPeriodSec: 60,
    argument: Buffer.from(JSON.stringify(input)),
  });

  if (res.completed !== undefined) {
    return unwrap(res.completed);
  }

  // 2. rebuild the previous execution state
  //
  const messages = decodeMessagesBuffer(res.executing ?? Buffer.alloc(0));
  const journalBuilder = new InvocationBuilder(method);
  messages.forEach((e: Message) => journalBuilder.handleMessage(e));
  const journal = journalBuilder.build();

  // resume the execution state machine
  const connection = new OutboundConnection(operationId, streamId, remote);

  const stateMachine = new StateMachine(
    connection,
    journal,
    ProtocolMode.BIDI_STREAM
  );

  // track the state machine execution result
  let done = false;

  const invocation = stateMachine.invoke().finally(() => (done = true));

  // keep pulling for input and feeding this to the fsm.
  try {
    while (!done) {
      const recv = await remote.recv({
        operationId,
        streamId,
      });
      if (recv.invalidStream !== undefined) {
        throw new Error("Operation fenced off");
      }
      const buffer = recv.messages ?? Buffer.alloc(0);
      const messages = decodeMessagesBuffer(buffer);
      messages.forEach((m: Message) => stateMachine.handleMessage(m));
    }
  } catch (e) {
    if (!(e instanceof RequestError) || !e.precondtionFailed()) {
      stateMachine.handleStreamError(e as Error);
    }
  }

  // wait for the state machine to complete the invocation
  const maybeResult = await invocation;
  if (maybeResult instanceof Buffer) {
    return JSON.parse(maybeResult.toString());
  }

  // TODO: no sure what to do here. The state machine has decided to be suspended?
  throw new Error("suspended");
}
