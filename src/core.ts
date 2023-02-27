import { Message } from "@bufbuild/protobuf";

export interface RestateContext {
  // TODO: what goes here
  dummy: string;
}

export type RestateMethod<I extends Message<I>, O extends Message<O>> = (
  context: RestateContext,
  message: Message<I>
) => Promise<O>;

/**
 * {
 *     method: "dev.restate.Greeter/greet",
 *     async fn(context, message) {
 *         ...
 *     }
 * }
 */
export interface MethodOpts<I extends Message<I>, O extends Message<O>> {
  method: string;
  fn: RestateMethod<I, O>;
}

export class MethodSpec<I extends Message<I>, O extends Message<O>>
  implements MethodOpts<I, O>
{
  constructor(readonly method: string, readonly fn: RestateMethod<I, O>) {}

  static fromOpts<I extends Message<I>, O extends Message<O>>({
    method,
    fn,
  }: MethodOpts<I, O>): MethodSpec<I, O> {
    if (fn === undefined || fn === null) {
      throw new Error(`missing method instance for ${method}`);
    }
    return new MethodSpec(method, fn);
  }
}
