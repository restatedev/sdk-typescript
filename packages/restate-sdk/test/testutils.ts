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
} from "../src/public_api.js";
import { NodeEndpoint } from "../src/endpoint/node_endpoint.js";
import type * as d from "../src/types/discovery.js";

/**
 * This class' only purpose is to make certain methods accessible in tests.
 * Those methods are otherwise protected, to reduce the public interface and
 * make it simpler for users to understand what methods are relevant for them,
 * and which ones are not.
 */
class TestRestateServer extends NodeEndpoint {}

export function toServiceDiscovery<N extends string, T>(
  definition:
    | ServiceDefinition<N, T>
    | VirtualObjectDefinition<N, T>
    | WorkflowDefinition<N, T>
): d.Service {
  const restateServer = new TestRestateServer();
  restateServer.bind(definition);

  const discovery = restateServer.componentByName(definition.name)?.discovery();
  if (discovery) {
    return discovery;
  }
  throw new Error(`Discovery should not be null for ${definition.name}`);
}
