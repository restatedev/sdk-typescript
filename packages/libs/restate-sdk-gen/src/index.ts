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

// Public API.

export type { Channel } from "./channel.js";
export type { FluentClient, FluentDurablePromise } from "./clients.js";
export {
  all,
  allSettled,
  any,
  attach,
  awakeable,
  cancel,
  channel,
  clearAllState,
  clearState,
  genericCall,
  genericSend,
  getAllStateKeys,
  getState,
  objectClient,
  objectSendClient,
  race,
  rejectAwakeable,
  resolveAwakeable,
  run,
  serviceClient,
  serviceSendClient,
  setState,
  signal,
  sleep,
  state,
  workflowClient,
  workflowPromise,
  workflowSendClient,
} from "./free.js";
export type {
  Future,
  FutureFulfilledResult,
  FutureRejectedResult,
  FutureSettledResult,
  FutureValue,
  FutureValues,
} from "./future.js";
export {
  gen,
  type Operation,
  select,
  type SelectResult,
  spawn,
} from "./operation.js";
export {
  execute,
  type RetryOptions,
  type RunAction,
  type RunActionOpts,
  type RunOpts,
  wrapActionForCancellation,
} from "./restate-operations.js";
export {
  typed,
  type TypedNoDefault,
  type StateKeySpec,
  type AnyKeySpec,
  type SpecValue,
  type SpecHasDefault,
  type StateKeyAccessor,
  type StateAccessors,
  type UntypedStateAccessors,
} from "./state.js";
