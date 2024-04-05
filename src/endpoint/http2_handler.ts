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
import { finished, pipeline } from "stream/promises";
import http2, { Http2ServerRequest, Http2ServerResponse } from "http2";
import { parse as urlparse, Url } from "url";
import { EndpointImpl } from "./endpoint_impl";
import { RestateHttp2Connection } from "../connection/http_connection";
import { ensureError } from "../types/errors";
import { InvocationBuilder } from "../invocation";
import { StateMachine } from "../state_machine";
import { rlog } from "../logger";
import {
  ComponentHandler,
  parseUrlComponents,
  UrlPathComponents,
  VirtualObjectHandler,
} from "../types/components";
import { Deployment, ProtocolMode } from "../types/discovery";
import { validateRequestSignature } from "./request_signing/validate";
import { ServerHttp2Stream } from "node:http2";

export class Http2Handler {
  constructor(private readonly endpoint: EndpointImpl) {}

  acceptConnection(
    request: Http2ServerRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _response: Http2ServerResponse
  ) {
    const stream = request.stream;
    const url: Url = urlparse(request.url ?? "/");

    this.validateConnectionSignature(request, url, stream)
      .then((result) => {
        if (!result) {
          return;
        } else {
          return this.handleConnection(url, stream);
        }
      })
      .catch((e) => {
        const error = ensureError(e);
        rlog.error(
          "Error while handling connection: " + (error.stack ?? error.message)
        );
        stream.end();
        stream.destroy();
      });
  }

  private async validateConnectionSignature(
    request: Http2ServerRequest,
    url: Url,
    stream: ServerHttp2Stream
  ): Promise<boolean> {
    if (!this.endpoint.keySet) {
      // not validating
      return true;
    }

    const keySet = this.endpoint.keySet;

    const validateResponse = await validateRequestSignature(
      keySet,
      url.path ?? "/",
      request.headers
    );

    if (!validateResponse.valid) {
      rlog.error(`Rejecting request as its JWT did not validate`);
      stream.respond({
        "content-type": "application/restate",
        ":status": 401,
      });
      stream.end();
      stream.destroy();
      return false;
    } else {
      return true;
    }
  }

  private handleConnection(
    url: Url,
    stream: http2.ServerHttp2Stream
  ): Promise<void> {
    const route = parseUrlComponents(url.path ?? undefined);
    if (!route) {
      return respondNotFound(stream);
    }
    if (route === "discovery") {
      return respondDiscovery(this.endpoint.computeDiscovery(), stream);
    }
    const urlComponents = route as UrlPathComponents;
    const component = this.endpoint.componentByName(
      urlComponents.componentName
    );
    if (!component) {
      return respondNotFound(stream);
    }
    const handler = component.handlerMatching(urlComponents);
    if (!handler) {
      return respondNotFound(stream);
    }
    // valid connection, let's dispatch the invocation
    stream.respond({
      "content-type": "application/restate",
      ":status": 200,
    });
    const restateStream = RestateHttp2Connection.from(stream);
    return handleInvocation(handler, restateStream);
  }
}

function respondDiscovery(
  response: Deployment,
  http2Stream: http2.ServerHttp2Stream
) {
  const responseData = JSON.stringify(response);

  http2Stream.respond({
    ":status": 200,
    "content-type": "application/json",
  });

  return pipeline(stream.Readable.from(responseData), http2Stream, {
    end: true,
  });
}

function respondNotFound(stream: http2.ServerHttp2Stream) {
  stream.respond({
    "content-type": "application/json",
    ":status": 404,
  });
  stream.end();
  return finished(stream);
}

async function handleInvocation(
  handler: ComponentHandler,
  connection: RestateHttp2Connection
) {
  // step 1: collect all journal events
  const journalBuilder = new InvocationBuilder(handler);
  connection.pipeToConsumer(journalBuilder);
  try {
    await journalBuilder.completion();
  } finally {
    // ensure GC friendliness, also in case of errors
    connection.removeCurrentConsumer();
  }

  // step 2: create the state machine
  const invocation = journalBuilder.build();
  const stateMachine = new StateMachine(
    connection,
    invocation,
    ProtocolMode.BIDI_STREAM,
    handler instanceof VirtualObjectHandler,
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
