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

import { RpcContext, useContext } from "../restate_context";
import { GrpcServiceMethod, HostedGrpcServiceMethod } from "../types/grpc";

export function wrapHandler<I, O>(
  handler: (ctx: RpcContext, input: I) => Promise<O>
): HostedGrpcServiceMethod<I, O> {
  const localMethod = (instance: unknown, input: I): Promise<O> => {
    const ctx = useContext(instance) as unknown as RpcContext;
    return handler(ctx, input);
  };

  const encoder = (output: O): Uint8Array =>
    Buffer.from(JSON.stringify(output));
  const decoder = (buf: Uint8Array): I => JSON.parse(buf.toString());

  const method = new GrpcServiceMethod<I, O>(
    "",
    "",
    localMethod,
    decoder,
    encoder
  );

  return new HostedGrpcServiceMethod<I, O>({}, "", "", method);
}
