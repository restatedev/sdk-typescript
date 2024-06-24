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

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { RestateEndpoint, ServiceBundle } from "../public_api.js";
import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

import { rlog } from "../logger.js";
import type { Http2ServerRequest, Http2ServerResponse } from "http2";
import * as http2 from "http2";
import { LambdaHandler } from "./handlers/lambda.js";
import type { Component } from "../types/components.js";
import type { KeySetV1 } from "./request_signing/v1.js";
import { EndpointBuilder } from "./endpoint_builder.js";
import { GenericHandler, type RestateResponse } from "./handlers/generic.js";
import { Readable, Writable } from "node:stream";
import type { WritableStream } from "node:stream/web";
import { ProtocolMode } from "../types/discovery.js";
import { ensureError } from "../types/errors.js";

export class NodeEndpoint implements RestateEndpoint {
  private builder: EndpointBuilder = new EndpointBuilder();

  public get keySet(): KeySetV1 | undefined {
    return this.builder.keySet;
  }

  public componentByName(componentName: string): Component | undefined {
    return this.builder.componentByName(componentName);
  }

  public addComponent(component: Component) {
    this.builder.addComponent(component);
  }

  public bindBundle(services: ServiceBundle): RestateEndpoint {
    services.registerServices(this);
    return this;
  }

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): RestateEndpoint {
    this.builder.bind(definition);
    return this;
  }

  public withIdentityV1(...keys: string[]): RestateEndpoint {
    this.builder.withIdentityV1(...keys);
    return this;
  }

  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void {
    const handler = new GenericHandler(this.builder, ProtocolMode.BIDI_STREAM);

    return (request, response) => {
      const url = request.url;

      handler
        .handle({
          url,
          headers: request.headers,
          body: Readable.toWeb(request),
        })
        .then(async (resp: RestateResponse) => {
          response.writeHead(resp.statusCode, resp.headers);
          if (resp.body instanceof Uint8Array) {
            await new Promise((resolve, reject) =>
              response.write(resp.body as Uint8Array, (err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(undefined);
                }
              })
            );
            await new Promise<void>((resolve) => response.end(resolve));
          } else {
            const responseWeb = Writable.toWeb(
              response
            ) as WritableStream<Uint8Array>;
            await resp.body.pipeTo(responseWeb);
            await new Promise<void>((resolve) => response.end(resolve));
          }
        })
        .catch((e) => {
          const error = ensureError(e);
          rlog.error(
            "Error while handling connection: " + (error.stack ?? error.message)
          );
          response.end();
          response.destroy();
        });
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any> {
    const genericHandler = new GenericHandler(
      this.builder,
      ProtocolMode.REQUEST_RESPONSE
    );
    const handler = new LambdaHandler(genericHandler);
    return handler.handleRequest.bind(handler);
  }

  listen(port?: number): Promise<number> {
    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    rlog.info(`Listening on ${actualPort}...`);

    const server = http2.createServer(this.http2Handler());

    return new Promise((resolve, reject) => {
      let failed = false;
      server.once("error", (e) => {
        failed = true;
        reject(e);
      });
      server.listen(actualPort, () => {
        if (failed) {
          return;
        }
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(
            new TypeError(
              "endpoint.listen() currently supports only binding to a PORT"
            )
          );
        } else {
          resolve(address.port);
        }
      });
    });
  }
}
