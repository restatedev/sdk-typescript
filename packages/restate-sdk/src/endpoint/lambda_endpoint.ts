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

import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";
import type {
  ClientCallOptsMapper,
  ClientSendOptsMapper,
} from "../types/rpc.js";
import type { Component } from "../types/components.js";
import { EndpointBuilder } from "./endpoint_builder.js";
import type { RestateEndpointBase } from "../endpoint.js";
import { GenericHandler } from "./handlers/generic.js";
import { LambdaHandler } from "./handlers/lambda.js";
import { ProtocolMode } from "../types/discovery.js";
import type { LoggerTransport } from "../logging/logger_transport.js";

/**
 * LambdaEndpoint encapsulates all the Restate services served by this endpoint.
 *
 *
 * @example
 * A typical endpoint served as Lambda would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/lambda";
 *
 * export const handler = restate
 *   .endpoint()
 *   .bind(myService)
 *   .handler();
 */
export interface LambdaEndpoint extends RestateEndpointBase<LambdaEndpoint> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(): (event: any, ctx: any) => Promise<any>;
}

export class LambdaEndpointImpl implements LambdaEndpoint {
  private builder: EndpointBuilder = new EndpointBuilder();

  public get keySet(): string[] {
    return this.builder.keySet;
  }

  public componentByName(componentName: string): Component | undefined {
    return this.builder.componentByName(componentName);
  }

  public addComponent(component: Component) {
    this.builder.addComponent(component);
  }

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): LambdaEndpoint {
    this.builder.bind(definition);
    return this;
  }

  public withIdentityV1(...keys: string[]): LambdaEndpoint {
    this.builder.withIdentityV1(...keys);
    return this;
  }

  public setLogger(logger: LoggerTransport): LambdaEndpoint {
    this.builder.setLogger(logger);
    return this;
  }

  public setClientCallOptsMapper(
    optsMapper: ClientCallOptsMapper
  ): LambdaEndpoint {
    this.builder.setClientCallOptsMapper(optsMapper);
    return this;
  }

  public setClientSendOptsMapper(
    optsMapper: ClientSendOptsMapper
  ): LambdaEndpoint {
    this.builder.setClientSendOptsMapper(optsMapper);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(): (event: any, ctx: any) => Promise<any> {
    const genericHandler = new GenericHandler(
      this.builder,
      ProtocolMode.REQUEST_RESPONSE
    );
    const lambdaHandler = new LambdaHandler(genericHandler);
    return lambdaHandler.handleRequest.bind(lambdaHandler);
  }
}
