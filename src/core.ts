export interface RestateContext {
  // TODO: what goes here
  dummy: string
}

export type RestateMethod = (
  context: RestateContext,
  message: any
) => void | Promise<void>;

/**
 * {
 *     method: "dev.restate.Greeter/greet",
 *     async fn(context, message) {
 *         ...
 *     }
 * }
 */
export interface MethodOpts {
  method: string;
  fn: RestateMethod;
}

export class MethodSpec implements MethodOpts {
  constructor(readonly method: string, readonly fn: RestateMethod) {}

  static fromOpts({method, fn}: MethodOpts): MethodSpec {
    if (fn === undefined || fn === null) {
      throw new Error(`missing method instance for ${method}`);
    }
    return new MethodSpec(method, fn);
  }
}
