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
import type { Component } from "../types/components.js";
import { EndpointBuilder } from "./endpoint_builder.js";
import type { RestateEndpointBase } from "../endpoint.js";
import { GenericHandler } from "./handlers/generic.js";
import { fetcher } from "./handlers/fetch.js";
import type { LoggerTransport } from "../logging/logger_transport.js";
import type { ProtocolMode } from "../types/discovery.js";

/**
 * Generic Fetch encapsulates all the Restate services served by this endpoint.
 *
 *
 * @example
 * A typical request-response handler would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/fetch";
 *
 * export default restate
 *   .endpoint()
 *   .bind(myService)
 *   .handler();
 * @example
 * A typical bidirectional handler (works with http2 and some http1.1 servers) would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/fetch";
 *
 * export default restate
 *   .endpoint()
 *   .bidirectional()
 *   .bind(myService)
 *   .handler();
 */
export interface FetchEndpoint extends RestateEndpointBase<FetchEndpoint> {
  handler(): {
    fetch: (request: Request, ...extraArgs: unknown[]) => Promise<Response>;
  };
  bidirectional(set?: boolean): FetchEndpoint;
}

export class FetchEndpointImpl implements FetchEndpoint {
  constructor(private protocolMode: ProtocolMode) {}
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
  ): FetchEndpoint {
    this.builder.bind(definition);
    return this;
  }

  public withIdentityV1(...keys: string[]): FetchEndpoint {
    this.builder.withIdentityV1(...keys);
    return this;
  }

  public setLogger(newLogger: LoggerTransport): FetchEndpoint {
    this.builder.setLogger(newLogger);
    return this;
  }

  public bidirectional(set: boolean = true): FetchEndpoint {
    this.protocolMode = set ? "BIDI_STREAM" : "REQUEST_RESPONSE";
    return this;
  }

  handler(): {
    fetch: (request: Request, ...extraArgs: unknown[]) => Promise<Response>;
  } {
    const genericHandler = new GenericHandler(this.builder, this.protocolMode);
    return fetcher(genericHandler);
  }
}
