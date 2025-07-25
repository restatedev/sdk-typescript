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
import { EndpointBuilder } from "./endpoint.js";
import type {
  DefaultServiceOptions,
  RestateEndpointBase,
} from "../endpoint.js";
import { GenericHandler } from "./handlers/generic.js";
import { LambdaHandler } from "./handlers/lambda.js";
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
    this.builder.addIdentityKeys(...keys);
    return this;
  }

  public defaultServiceOptions(options: DefaultServiceOptions): LambdaEndpoint {
    this.builder.setDefaultServiceOptions(options);
    return this;
  }

  public setLogger(logger: LoggerTransport): LambdaEndpoint {
    this.builder.setLogger(logger);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(): (event: any, ctx: any) => Promise<any> {
    const genericHandler = new GenericHandler(
      this.builder.build(),
      "REQUEST_RESPONSE"
    );
    const lambdaHandler = new LambdaHandler(genericHandler);
    return lambdaHandler.handleRequest.bind(lambdaHandler);
  }
}
