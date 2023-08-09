/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { RpcRequest } from "../generated/proto/dynrpc";

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
        throw new Error(
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
      throw new Error("wrong number of arguments " + args.length);
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

export const verifyAssumptions = (
  isKeyed: boolean,
  request: RpcRequest
): { key?: string; request?: JsType } => {
  const assumpsion = request.senderAssumes ?? 0;
  switch (assumpsion) {
    case ASSUME_UNKEYED_SINCE_FIRST_PARAM_NOT_STRING: {
      if (isKeyed) {
        throw new Error(
          `Trying to call a keyed handler with a missing key. This could happen if the first argument passed is not a 'string'.`
        );
      }
      return { request: request.request };
    }
    case ASSUME_UNKEYED_SINCE_ZERO_ARGS: {
      if (isKeyed) {
        throw new Error(
          `A keyed handler must at least be invoked with a single non empty string argument, that represents the key. 0 arguments given.`
        );
      }
      return { request: request.request };
    }
    case ASSUME_KEYED_SINCE_TWO_ARGS_STR_AND_ANY: {
      if (!isKeyed) {
        throw new Error(
          `An unkeyed handler must have at most 1 argument. two given.`
        );
      }
      return { key: request.key, request: request.request };
    }
    case ASSUME_EITHER_KEYED_OR_UNKEYED_ONE_STR_ARG: {
      if (isKeyed) {
        return { key: request.key };
      }
      return { request: request.key };
    }
    default: {
      // no assumptions.
      return { key: request.key, request: request.request };
    }
  }
};
