/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import stream from "stream";
import { pipeline, finished } from "stream/promises";
import http2, { Http2ServerRequest, Http2ServerResponse } from "http2";
import { parse as urlparse, Url } from "url";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { EndpointImpl } from "./endpoint_impl";
import { RestateHttp2Connection } from "../connection/http_connection";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { ensureError } from "../types/errors";
import { InvocationBuilder } from "../invocation";
import { StateMachine } from "../state_machine";
import { rlog } from "../logger";

export class Http2Handler {
  private readonly discoveryResponse: ServiceDiscoveryResponse;
  constructor(private readonly endpoint: EndpointImpl) {
    this.discoveryResponse = ServiceDiscoveryResponse.fromPartial({
      ...this.endpoint.discovery,
      protocolMode: ProtocolMode.BIDI_STREAM,
    });
  }

  acceptConnection(
    request: Http2ServerRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _response: Http2ServerResponse
  ) {
    const stream = request.stream;
    const url: Url = urlparse(request.url ?? "/");

    this.handleConnection(url, stream).catch((e) => {
      const error = ensureError(e);
      rlog.error(
        "Error while handling connection: " + (error.stack ?? error.message)
      );
      stream.end();
      stream.destroy();
    });
  }

  private async handleConnection(
    url: Url,
    stream: http2.ServerHttp2Stream
  ): Promise<void> {
    const method = this.endpoint.methodByUrl(url.path);

    if (method !== undefined) {
      // valid connection, let's dispatch the invocation
      stream.respond({
        "content-type": "application/restate",
        ":status": 200,
      });

      const restateStream = RestateHttp2Connection.from(stream);
      await handleInvocation(method, restateStream);
      return;
    }

    // no method under that name. might be a discovery request
    if (url.path == "/discover") {
      rlog.info(
        "Answering discovery request. Announcing services: " +
          JSON.stringify(this.discoveryResponse.services)
      );
      await respondDiscovery(this.discoveryResponse, stream);
      return;
    }

    // no discovery, so unknown method: 404
    rlog.error(`No service and function found for URL ${url.path}`);
    await respondNotFound(stream);
  }
}

async function respondDiscovery(
  response: ServiceDiscoveryResponse,
  http2Stream: http2.ServerHttp2Stream
) {
  const responseData = ServiceDiscoveryResponse.encode(response).finish();

  http2Stream.respond({
    ":status": 200,
    "content-type": "application/proto",
  });

  await pipeline(stream.Readable.from(responseData), http2Stream, {
    end: true,
  });
}

async function respondNotFound(stream: http2.ServerHttp2Stream) {
  stream.respond({
    "content-type": "application/restate",
    ":status": 404,
  });
  stream.end();
  await finished(stream);
}

async function handleInvocation<I, O>(
  func: HostedGrpcServiceMethod<I, O>,
  connection: RestateHttp2Connection
) {
  // step 1: collect all journal events
  const journalBuilder = new InvocationBuilder<I, O>(func);
  connection.pipeToConsumer(journalBuilder);
  try {
    await journalBuilder.completion();
  } finally {
    // ensure GC friendliness, also in case of errors
    connection.removeCurrentConsumer();
  }

  // step 2: create the state machine
  const invocation = journalBuilder.build();
  const stateMachine = new StateMachine<I, O>(
    connection,
    invocation,
    ProtocolMode.BIDI_STREAM,
    func.method.keyedContext,
    invocation.inferLoggerContext()
  );
  connection.pipeToConsumer(stateMachine);

  // step 3: invoke the function

  // This call would propagate errors in the state machine logic, but not errors
  // in the application function code. Ending a function with an error as well
  // as failign an invocation and being retried are perfectly valid actions from the
  // SDK's perspective.
  try {
    await stateMachine.invoke();
  } finally {
    // ensure GC friendliness, also in case of errors
    connection.removeCurrentConsumer();
  }
}
