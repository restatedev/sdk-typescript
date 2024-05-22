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

import stream from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import http2, { Http2ServerRequest, Http2ServerResponse } from "http2";
import { EndpointImpl } from "./endpoint_impl";
import { RestateHttp2Connection } from "../connection/http_connection";
import { ensureError } from "../types/errors";
import { InvocationBuilder } from "../invocation";
import { StateMachine } from "../state_machine";
import { rlog } from "../logger";
import {
  ComponentHandler,
  UrlPathComponents,
  parseUrlComponents,
} from "../types/components";
import { Endpoint, ProtocolMode } from "../types/discovery";
import { validateRequestSignature } from "./request_signing/validate";
import { ServerHttp2Stream } from "node:http2";
import { X_RESTATE_SERVER } from "../user_agent";
import {
  isServiceProtocolVersionSupported,
  parseServiceProtocolVersion,
  selectSupportedServiceDiscoveryProtocolVersion,
  serviceDiscoveryProtocolVersionToHeaderValue,
  serviceProtocolVersionToHeaderValue,
} from "../types/protocol";
import { ServiceDiscoveryProtocolVersion } from "../generated/proto/discovery_pb";

export class Http2Handler {
  constructor(private readonly endpoint: EndpointImpl) {}

  acceptConnection(
    request: Http2ServerRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _response: Http2ServerResponse
  ) {
    const stream = request.stream;
    const url: URL = new URL(request.url ?? "/", "https://restate.dev"); // use a dummy base; we only care about path

    this.validateConnectionSignature(request, url, stream)
      .then((result) => {
        if (!result) {
          return;
        } else {
          return this.handleConnection(request, url, stream);
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
    url: URL,
    stream: ServerHttp2Stream
  ): Promise<boolean> {
    if (!this.endpoint.keySet) {
      // not validating
      return true;
    }

    const keySet = this.endpoint.keySet;

    const validateResponse = await validateRequestSignature(
      keySet,
      url.pathname ?? "/",
      request.headers
    );

    if (!validateResponse.valid) {
      rlog.error(
        `Rejecting request as its JWT did not validate: ${validateResponse.error}`
      );
      stream.respond({
        "content-type": "application/restate",
        "x-restate-server": X_RESTATE_SERVER,
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
    request: http2.Http2ServerRequest,
    url: URL,
    stream: http2.ServerHttp2Stream
  ): Promise<void> {
    const route = parseUrlComponents(url.pathname ?? undefined);
    if (!route) {
      return respondNotFound(stream);
    }
    if (route === "discovery") {
      const acceptVersionsString = request.headers["accept"];

      const serviceDiscoveryProtocolVersion =
        selectSupportedServiceDiscoveryProtocolVersion(acceptVersionsString);

      if (
        serviceDiscoveryProtocolVersion ==
        ServiceDiscoveryProtocolVersion.SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED
      ) {
        const errorMessage = `Unsupported service discovery protocol version '${acceptVersionsString}'`;
        rlog.warn(errorMessage);
        return respondUnsupportedProtocolVersion(stream, errorMessage);
      }

      const discovery = this.endpoint.computeDiscovery(
        ProtocolMode.BIDI_STREAM
      );
      return respondDiscovery(
        serviceDiscoveryProtocolVersion,
        discovery,
        stream
      );
    }

    const serviceProtocolVersionString = request.headers["content-type"];
    const serviceProtocolVersion = parseServiceProtocolVersion(
      serviceProtocolVersionString
    );

    if (!isServiceProtocolVersionSupported(serviceProtocolVersion)) {
      const errorMessage = `Unsupported service protocol version '${serviceProtocolVersionString}'`;
      rlog.warn(errorMessage);
      return respondUnsupportedProtocolVersion(stream, errorMessage);
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
      "content-type": serviceProtocolVersionToHeaderValue(
        serviceProtocolVersion
      ),
      "x-restate-server": X_RESTATE_SERVER,
      ":status": 200,
    });
    const restateStream = RestateHttp2Connection.from(request, stream);
    return handleInvocation(handler, restateStream);
  }
}

function respondUnsupportedProtocolVersion(
  stream: http2.ServerHttp2Stream,
  errorMessage: string
) {
  stream.respond({
    ":status": 415,
    "content-type": "text/plain",
    "x-restate-server": X_RESTATE_SERVER,
  });
  stream.end(errorMessage);
  return finished(stream);
}

function respondDiscovery(
  serviceDiscoveryProtocolVersion: ServiceDiscoveryProtocolVersion,
  response: Endpoint,
  http2Stream: http2.ServerHttp2Stream
) {
  let responseData;
  if (serviceDiscoveryProtocolVersion === ServiceDiscoveryProtocolVersion.V1) {
    responseData = JSON.stringify(response);
  } else {
    // should not be reached since we check for compatibility before
    throw new Error(
      `Unsupported service discovery protocol version: ${serviceDiscoveryProtocolVersion}`
    );
  }

  http2Stream.respond({
    ":status": 200,
    "content-type": serviceDiscoveryProtocolVersionToHeaderValue(
      serviceDiscoveryProtocolVersion
    ),
    "x-restate-server": X_RESTATE_SERVER,
  });

  return pipeline(stream.Readable.from(responseData), http2Stream, {
    end: true,
  });
}

function respondNotFound(stream: http2.ServerHttp2Stream) {
  stream.respond({
    "content-type": "application/json",
    "x-restate-server": X_RESTATE_SERVER,
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
    handler.kind(),
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
