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

import { RestateEndpoint, ServiceBundle } from "../public_api";
import type {
  ServiceDefinition,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk-core";

import { rlog } from "../logger";
import type { Http2ServerRequest, Http2ServerResponse } from "http2";
import * as http2 from "http2";
import { Http2Handler } from "./http2_handler";
import { LambdaHandler } from "./lambda_handler";
import { Component } from "../types/components";

import type { KeySetV1 } from "./request_signing/v1";
import type { WorkflowDefinition } from "@restatedev/restate-sdk-core";
import { EndpointBuilder } from "./endpoint_builder";

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
    if (!this.builder.keySet) {
      if (globalThis.process.env.NODE_ENV == "production") {
        rlog.warn(
          `Accepting HTTP requests without validating request signatures; endpoint access must be restricted`
        );
      }
    } else {
      rlog.info(
        `Validating HTTP requests using signing keys [${Array.from(
          this.builder.keySet.keys()
        )}]`
      );
    }
    const handler = new Http2Handler(this.builder);
    return handler.acceptConnection.bind(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any> {
    if (!this.builder.keySet) {
      rlog.warn(
        `Accepting Lambda requests without validating request signatures; Invoke permissions must be restricted`
      );
    } else {
      rlog.info(
        `Validating Lambda requests using signing keys [${Array.from(
          this.builder.keySet.keys()
        )}]`
      );
    }
    const handler = new LambdaHandler(this.builder);
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
