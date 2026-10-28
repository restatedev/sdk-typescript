/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

export { connect } from "./client.js";
export type {
  ExactlyOnceInvocation,
  ExactlyOnceProducer,
  IntegrationClient,
  IntegrationClientOptions,
  Invocation,
  InvocationDefaults,
  Producer,
  ProducerBase,
  ProducerOptions,
  SendOptions,
} from "./api.js";
export {
  IntegrationClientError,
  type IntegrationClientErrorKind,
} from "./errors.js";
