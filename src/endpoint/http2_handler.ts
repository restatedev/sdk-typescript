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
import { EndpointImpl, ServiceEndpoint } from "./endpoint_impl";
import { RestateHttp2Connection } from "../connection/http_connection";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { ensureError } from "../types/errors";
import { InvocationBuilder } from "../invocation";
import { StateMachine } from "../state_machine";
import { KeyedRouter, UnKeyedRouter } from "../types/router";
import { rlog } from "../logger";
import { ServiceOpts } from "../endpoint";

/**
 * @deprecated use {@link RestateEndpoint}
 */
export interface RestateServer extends ServiceEndpoint {
  // RestateServer is a http2 server handler that you can pass to http2.createServer.
  (request: Http2ServerRequest, response: Http2ServerResponse): void;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindService(serviceOpts: ServiceOpts): RestateServer;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindKeyedRouter<M>(path: string, router: KeyedRouter<M>): RestateServer;

  // overridden to make return type more specific
  // docs are inherited from ServiceEndpoint
  bindRouter<M>(path: string, router: UnKeyedRouter<M>): RestateServer;

  /**
   * Starts the Restate server and listens at the given port.
   *
   * If the port is undefined, this method will use the port set in the `PORT`
   * environment variable. If that variable is undefined as well, the method will
   * default to port 9080.
   *
   * This method's result promise never completes.
   *
   * This method is a shorthand for:
   *
   * @example
   * ```
   * const httpServer = http2.createServer(restateServer);
   * httpServer.listen(port);
   * ```
   *
   * If you need to manually control the server lifecycle, we suggest to manually instantiate the http2 server and use this object as request handler.
   *
   * @param port The port to listen at. May be undefined (see above).
   */
  listen(port?: number): Promise<void>;
}

/**
 * Creates a Restate entrypoint based on a HTTP2 server. The entrypoint will listen
 * for requests to the services at a specified port.
 *
 * This is the entrypoint to be used in most scenarios (standalone, Docker, Kubernetes, ...);
 * any deployments that forwards requests to a network endpoint. The prominent exception is
 * AWS Lambda, which uses the {@link restate_lambda_handler#lambdaApiGatewayHandler}
 * function to create an entry point.
 *
 * After creating this endpoint, register services on this entrypoint via {@link RestateServer.bindService }
 * and start it via {@link RestateServer.listen }.
 *
 * @example
 * A typical entry point would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk";
 *
 * export const handler = restate
 *   .createServer()
 *   .bindService({
 *      service: "MyService",
 *      instance: new myService.MyServiceImpl(),
 *      descriptor: myService.protoMetadata,
 *    })
 *   .listen(8000);
 * ```
 *
 * @deprecated use {@link RestateEndpoint}
 */
export function createServer(): RestateServer {
  // See https://stackoverflow.com/questions/16508435/implementing-typescript-interface-with-bare-function-signature-plus-other-fields/16508581#16508581
  // for more details on how we implement the RestateServer interface.

  const endpointImpl = new EndpointImpl();
  const handler = new Http2Handler(endpointImpl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance: any = (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => {
    handler.acceptConnection(request, response);
  };
  instance.bindKeyedRouter = <M>(path: string, router: UnKeyedRouter<M>) => {
    endpointImpl.bindKeyedRouter(path, router);
    return instance;
  };
  instance.bindRouter = <M>(path: string, router: UnKeyedRouter<M>) => {
    endpointImpl.bindRouter(path, router);
    return instance;
  };
  instance.bindService = (serviceOpts: ServiceOpts) => {
    endpointImpl.bindService(serviceOpts);
    return instance;
  };

  instance.listen = (port?: number) => {
    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    rlog.info(`Listening on ${actualPort}...`);

    const server = http2.createServer(instance);
    server.listen(actualPort);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return new Promise(() => {});
  };

  return <RestateServer>instance;
}

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
