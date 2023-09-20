import { RpcContext, useContext } from "../restate_context";
import { RpcContextImpl } from "../restate_context_impl";
import { GrpcServiceMethod, HostedGrpcServiceMethod } from "../types/grpc";

export function wrapHandler<I, O>(
  handler: (ctx: RpcContext, input: I) => Promise<O>
): HostedGrpcServiceMethod<I, O> {
  const localMethod = (instance: unknown, input: I): Promise<O> => {
    const ctx = new RpcContextImpl(useContext(instance));
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
