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
  DefaultServiceOptions,
} from "../src/public_api.js";
import type * as discovery from "../src/endpoint/discovery.js";
import { EndpointBuilder } from "../src/endpoint/endpoint.js";

export function toServiceDiscovery<N extends string, T>(
  definition:
    | ServiceDefinition<N, T>
    | VirtualObjectDefinition<N, T>
    | WorkflowDefinition<N, T>,
  defaultServiceOptions?: DefaultServiceOptions
): discovery.Service {
  const endpointBuilder = new EndpointBuilder();
  endpointBuilder.bind(definition);
  if (defaultServiceOptions) {
    endpointBuilder.setDefaultServiceOptions(defaultServiceOptions);
  }

  const endpoint = endpointBuilder.build();
  const discovery = endpoint.discoveryMetadata.services.find(
    (s) => s.name === definition.name
  );
  if (discovery) {
    return discovery;
  }
  throw new Error(`Discovery should not be null for ${definition.name}`);
}
