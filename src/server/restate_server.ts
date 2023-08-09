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

import { on } from "events";
import stream from "stream";
import { pipeline, finished } from "stream/promises";
import http2 from "http2";
import { parse as urlparse, Url } from "url";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { BaseRestateServer, ServiceOpts } from "./base_restate_server";
import { rlog } from "../utils/logger";
import { RestateHttp2Connection } from "../connection/http_connection";
import { HostedGrpcServiceMethod } from "../types/grpc";
import { ensureError } from "../types/errors";
import { InvocationBuilder } from "../invocation";
import { StateMachine } from "../state_machine";
import { KeyedRouter, UnKeyedRouter } from "../types/router";

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
 */
export function createServer(): RestateServer {
  return new RestateServer();
}

/**
 * Restate entrypoint implementation for services. This server receives and
 * decodes the requests, streams events between the service and the Restate runtime,
 * and drives the durable execution of the service invocations.
 */
export class RestateServer extends BaseRestateServer {
  constructor() {
    super(ProtocolMode.BIDI_STREAM);
  }

  public bindKeyedRouter<M>(
    path: string,
    router: KeyedRouter<M>
  ): RestateServer {
    // Implementation note: This override if here mainly to change the return type to the more
    // concrete type RestateServer (from BaseRestateServer).
    super.bindRpcService(path, router, true);
    return this;
  }

  public bindRouter<M>(path: string, router: UnKeyedRouter<M>): RestateServer {
    // Implementation note: This override if here mainly to change the return type to the more
    // concrete type RestateServer (from BaseRestateServer).
    super.bindRpcService(path, router, false);
    return this;
  }

  /**
   * Adds a gRPC service to be served from this endpoint.
   *
   * The {@link ServiceOpts} passed here need to describe the following properties:
   *
   *   - The 'service' name: the name of the gRPC service (as in the service definition proto file).
   *   - The service 'instance': the implementation of the service logic (must implement the generated
   *     gRPC service interface).
   *   - The gRPC/protobuf 'descriptor': The protoMetadata descriptor that describes the service, methods,
   *     and parameter types. It is usually found as the value 'protoMetadata' in the generated
   *     file '(service-name).ts'
   *
   *     The descriptor is generated by the protobuf compiler and needed by Restate to reflectively discover
   *     the service details, understand payload serialization, perform HTTP/JSON-to-gRPC transcoding, or
   *     to proxy the service.
   *
   * If you define multiple services in the same '.proto' file, you may have only one descriptor that
   * describes all services together. You can pass the same descriptor to multiple calls of '.bindService()'.
   *
   * If you don't find the gRPC/protobuf descriptor, make your you generated the gRPC/ProtoBuf code with
   * the option to generate the descriptor. For example, using the 'ts-proto' plugin, make sure you pass
   * the 'outputSchema=true' option. If you are using Restate's project templates, this should all be
   * pre-configured for you.
   *
   * @example
   * ```
   * endpoint.bindService({
   *   service: "MyService",
   *   instance: new myService.MyServiceImpl(),
   *   descriptor: myService.protoMetadata
   * })
   * ```
   *
   * @param serviceOpts The options describing the service to be bound. See above for a detailed description.
   * @returns An instance of this RestateServer
   */
  public bindService(serviceOpts: ServiceOpts): RestateServer {
    // Implementation note: This override if here mainly to change the return type to the more
    // concrete type RestateServer (from BaseRestateServer).
    super.bindService(serviceOpts);
    return this;
  }

  /**
   * Starts the Restate server and listens at the given port.
   *
   * If the port is undefined, this method will use the port set in the `PORT`
   * environment variable. If that variable is undefined as well, the method will
   * default to port 8080.
   *
   * This method's result promise never completes.
   *
   * @param port The port to listen at. May be undefined (see above).
   */
  public async listen(port?: number) {
    // Infer the port if not specified, or default it
    const actualPort = port ?? parseInt(process.env.PORT ?? "8080");
    rlog.info(`Listening on ${actualPort}...`);

    for await (const connection of incomingConnectionAtPort(actualPort)) {
      this.handleConnection(connection.url, connection.stream).catch((e) => {
        const error = ensureError(e);
        rlog.error(
          "Error while handling connection: " + (error.stack ?? error.message)
        );
        connection.stream.end();
        connection.stream.destroy();
      });
    }
  }

  private async handleConnection(
    url: Url,
    stream: http2.ServerHttp2Stream
  ): Promise<void> {
    const method = this.methodByUrl(url.path);

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
        "Answering discovery request. Registering these services: " +
          JSON.stringify(this.discovery.services)
      );
      await respondDiscovery(this.discovery, stream);
      return;
    }

    // no discovery, so unknown method: 404
    rlog.error(`No service and function found for URL ${url.path}`);
    await respondNotFound(stream);
  }
}

async function* incomingConnectionAtPort(port: number) {
  const server = http2.createServer();

  server.on("error", (err) =>
    rlog.error("Error in Restate service endpoint http2 server: " + err)
  );
  server.listen(port);

  let connectionId = 1n;

  for await (const [s, h] of on(server, "stream")) {
    const stream = s as http2.ServerHttp2Stream;
    const headers = h as http2.IncomingHttpHeaders;
    const url: Url = urlparse(headers[":path"] ?? "/");
    connectionId++;
    yield { connectionId, url, headers, stream };
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
  const stateMachine = new StateMachine<I, O>(
    connection,
    journalBuilder.build(),
    ProtocolMode.BIDI_STREAM
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
