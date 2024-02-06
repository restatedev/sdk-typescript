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

import { RpcRequest } from "../generated/proto/dynrpc";
import { TerminalError } from "../types/errors";

const ASSUME_UNKEYED_SINCE_FIRST_PARAM_NOT_STRING = 1;
const ASSUME_UNKEYED_SINCE_ZERO_ARGS = 2;
const ASSUME_KEYED_SINCE_TWO_ARGS_STR_AND_ANY = 3;
const ASSUME_EITHER_KEYED_OR_UNKEYED_ONE_STR_ARG = 4;

export const requestFromArgs = (args: unknown[]): RpcRequest => {
  switch (args.length) {
    case 0: {
      return RpcRequest.create({
        senderAssumes: ASSUME_UNKEYED_SINCE_ZERO_ARGS,
      });
    }
    case 1: {
      if (typeof args[0] === "string") {
        return RpcRequest.create({
          key: args[0],
          senderAssumes: ASSUME_EITHER_KEYED_OR_UNKEYED_ONE_STR_ARG,
        });
      } else {
        return RpcRequest.create({
          request: args[0],
          senderAssumes: ASSUME_UNKEYED_SINCE_FIRST_PARAM_NOT_STRING,
        });
      }
    }
    case 2: {
      if (typeof args[0] !== "string") {
        throw new TerminalError(
          `Two argument handlers are only possible for keyed handlers. Where the first argument must be of type 'string'.`
        );
      }
      return RpcRequest.create({
        key: args[0],
        request: args[1],
        senderAssumes: ASSUME_KEYED_SINCE_TWO_ARGS_STR_AND_ANY,
      });
    }
    default: {
      throw new TerminalError("wrong number of arguments " + args.length);
    }
  }
};

/* eslint-disable @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any */
export type JsType =
  | string
  | number
  | boolean
  | Object
  | null
  | Array<any>
  | undefined;
/* eslint-enable @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any */

const requireThat = (condition: boolean, errorMessage: string) => {
  if (!condition) {
    throw new TerminalError(errorMessage);
  }
};

export const verifyAssumptions = (
  isKeyed: boolean,
  request: RpcRequest
): { key?: string; request?: JsType } => {
  const assumption = request.senderAssumes ?? 0;
  switch (assumption) {
    case 0: {
      // no assumption: this comes from an ingress.
      const hasKeyProperty =
        typeof request.key === "string" && request.key.length > 0;
      if (isKeyed) {
        requireThat(
          hasKeyProperty,
          "Trying to call a keyed handler with a missing or empty 'key' property."
        );
      } else {
        requireThat(
          !hasKeyProperty,
          "Trying to call a an unkeyed handler with a 'key' property. Did you mean using the 'request' property instead?"
        );
      }
      return { key: request.key, request: request.request };
    }
    case ASSUME_UNKEYED_SINCE_FIRST_PARAM_NOT_STRING: {
      requireThat(
        !isKeyed,
        "Trying to call a keyed handler with a missing key. This could happen if the first argument passed is not a 'string'."
      );
      return { request: request.request };
    }
    case ASSUME_UNKEYED_SINCE_ZERO_ARGS: {
      requireThat(
        !isKeyed,
        "A keyed handler must at least be invoked with a single non empty string argument, that represents the key. 0 arguments given."
      );
      return { request: request.request };
    }
    case ASSUME_KEYED_SINCE_TWO_ARGS_STR_AND_ANY: {
      requireThat(
        isKeyed,
        "An unkeyed handler must have at most 1 argument. two given."
      );
      return { key: request.key, request: request.request };
    }
    case ASSUME_EITHER_KEYED_OR_UNKEYED_ONE_STR_ARG: {
      if (isKeyed) {
        return { key: request.key };
      }
      return { request: request.key };
    }
    default: {
      throw new TerminalError(
        `Unknown assumption id ${assumption}. This indicates an incorrect (or involuntary) setting of the assumption property at the ingress request, or an SDK bug.`
      );
    }
  }
};
