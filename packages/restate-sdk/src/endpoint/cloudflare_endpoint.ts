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

import { rlog } from "../logger.js";
import type { Component } from "../types/components.js";

import type { KeySetV1 } from "./request_signing/v1.js";
import { EndpointBuilder } from "./endpoint_builder.js";
import type {
  RestateEndpoint,
  RestateEndpointBase,
  ServiceBundle,
} from "../endpoint.js";
import { CloudflareHandler } from "./handlers/cloudflare.js";
import { GenericHandler } from "./handlers/generic.js";

/**
 * CloudflareWorkerEndpoint encapsulates all the Restate services served by this endpoint.
 *
 *
 * @example
 * A typical endpoint served as CF worker would look like this:
 * ```
 * import * as restate from "@restatedev/restate-sdk/cloudflare";
 *
 * export default restate
 *   .endpoint()
 *   .bind(myService)
 *   .handler();
 */
export interface CloudflareWorkerEndpoint
  extends RestateEndpointBase<CloudflareWorkerEndpoint> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(): { fetch: (request: any) => Promise<any> };
}

export class CloudflareWorkerEndpointImpl implements CloudflareWorkerEndpoint {
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

  bindBundle(services: ServiceBundle): CloudflareWorkerEndpoint {
    services.registerServices(this as unknown as RestateEndpoint);
    return this;
  }

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ): CloudflareWorkerEndpoint {
    this.builder.bind(definition);
    return this;
  }

  public withIdentityV1(...keys: string[]): CloudflareWorkerEndpoint {
    this.builder.withIdentityV1(...keys);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(): { fetch: (request: any) => Promise<any> } {
    if (!this.builder.keySet) {
      rlog.warn(
        `Accepting requests without validating request signatures; worker access must be restricted`
      );
    } else {
      rlog.info(
        `Validating requests using signing keys [${Array.from(
          this.builder.keySet.keys()
        )}]`
      );
    }
    const genericHandler = new GenericHandler(this.builder);
    const cloudflareHandler = new CloudflareHandler(genericHandler);
    return {
      fetch: cloudflareHandler.fetch.bind(cloudflareHandler),
    };
  }
}
