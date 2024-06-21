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

import type { KeySetV1 } from "./request_signing/v1.js";
import { EndpointBuilder } from "./endpoint_builder.js";
import type {
  RestateEndpoint,
  RestateEndpointBase,
  ServiceBundle,
} from "../endpoint.js";
import { GenericHandler } from "./handlers/generic.js";
import { fetcher } from "./handlers/fetch.js";

/**
 * Generic Fetch encapsulates all the Restate services served by this endpoint.
 *
 *
 * @example
 * A typical endpoint served would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/fetch";
 *
 * export default restate
 *   .endpoint()
 *   .bind(myService)
 *   .handler();
 */
export interface FetchEndpoint extends RestateEndpointBase<FetchEndpoint> {
  handler(): { fetch: (request: Request) => Promise<Response> };
}

export class FetchEndpointImpl implements FetchEndpoint {
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

  bindBundle(services: ServiceBundle): FetchEndpoint {
    services.registerServices(this as unknown as RestateEndpoint);
    return this;
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

  handler(): {
    fetch: (request: Request) => Promise<Response>;
  } {
    const genericHandler = new GenericHandler(this.builder);
    return fetcher(genericHandler);
  }
}
