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

import { decodeMessagesBuffer } from "../io/decoder";
import { Message } from "../types/types";
import { GetResultResponse, RemoteContext } from "../generated/proto/services";
import { InvocationBuilder } from "../invocation";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { StateMachine } from "../state_machine";
import { ProtocolMode } from "../generated/proto/discovery";
import {
  EmbeddedConnection,
  FencedOffError,
} from "../connection/embedded_connection";

export const doInvoke = async <I, O>(
  remote: RemoteContext,
  operationId: string,
  streamId: string,
  method: HostedGrpcServiceMethod<I, O>,
  input: I
): Promise<O> => {
  //
  // 1. ask to Start this execution.
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

  //
  // 2. rebuild the previous execution state
  //

  const messages = decodeMessagesBuffer(res.executing ?? Buffer.alloc(0));
  const journalBuilder = new InvocationBuilder(method);
  messages.forEach((e: Message) => journalBuilder.handleMessage(e));
  const journal = journalBuilder.build();

  //
  // 3. resume the execution state machine
  //
  const connection = new EmbeddedConnection(operationId, streamId, remote);

  const stateMachine = new StateMachine(
    connection,
    journal,
    ProtocolMode.BIDI_STREAM,
    -1
  );

  //
  // 4. track the state machine execution result
  //
  let done = false;

  const invocation = stateMachine.invoke().finally(() => (done = true));

  //
  // 5. keep pulling for input and feeding this to the fsm.
  //
  try {
    while (!done) {
      const recv = await remote.recv({
        operationId,
        streamId,
      });
      if (recv.invalidStream !== undefined) {
        throw new FencedOffError();
      }
      if (recv.invocationCompleted !== undefined) {
        break;
      }
      const buffer = recv.messages ?? Buffer.alloc(0);
      const messages = decodeMessagesBuffer(buffer);
      messages.forEach((m: Message) => stateMachine.handleMessage(m));
    }
  } catch (e) {
    stateMachine.handleStreamError(e as Error);
    throw e;
  }

  //
  // 6. wait for the state machine to complete the invocation
  //
  const maybeResult = await invocation;
  if (maybeResult instanceof Buffer) {
    return JSON.parse(maybeResult.toString());
  }

  // TODO: no sure what to do here. The state machine has decided to be suspended?
  throw new Error("suspended");
};

const unwrap = <O>(response: GetResultResponse): O => {
  if (response.success === undefined) {
    throw new Error(response.failure?.message ?? "");
  }
  return JSON.parse(response.success.toString()) as O;
};
