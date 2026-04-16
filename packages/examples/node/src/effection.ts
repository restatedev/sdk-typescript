import * as restate from "@restatedev/restate-sdk";

import {
  action,
  Operation,
  lift,
  run,
  sleep,
  spawn,
  all,
  createChannel,
  each,
} from "effection";

export type RunOperation<T> = () => Operation<T>;

class EffectionContext {
  constructor(
    private readonly restateContext: restate.internal.ContextInternal,
    readonly rootPromise: restate.DynamicPromise<any>
  ) {}

  bridge<T>(restateOp: () => restate.RestatePromise<T>): Operation<T> {
    return action((resolve, reject) => {
      const promise = restateOp();
      const pub = restate.publicPromise(promise);
      this.rootPromise.addLeaf(promise);
      pub.then(resolve).catch(reject);
      return () => {};
    });
  }

  run<T>(
    name: string,
    action: RunOperation<T>,
    options: restate.RunOptions<T> | undefined = {}
  ): Operation<T> | Operation<T> | Operation<T> {
    // convert `() => Operation<T>` to `() => Promise<T>`
    const thunk = () => run(action);

    return this.bridge<T>(() =>
      this.restateContext.run(
        name as string,
        thunk as restate.RunAction<T>,
        options as restate.RunOptions<T>
      )
    );
  }

  awakeable<T>(serde?: restate.Serde<T>): Operation<{
    id: string;
    promise: Operation<T>;
  }> {
    return lift(() => {
      const p = this.restateContext.awakeable(serde);
      return {
        id: p.id,
        promise: this.bridge(() => p.promise),
      };
    })();
  }

  resolveAwakeable<T>(
    id: string,
    payload?: T,
    serde?: restate.Serde<T>
  ): Operation<void> {
    return lift(() => {
      this.restateContext.resolveAwakeable(id, payload, serde);
    })();
  }

  signal<T>(name: string, serde?: restate.Serde<T>): Operation<T> {
    return this.bridge(() => this.restateContext.signal(name, serde));
  }

  resolveSignal<T>(
    name: string,
    invocationId: string,
    payload: T,
    serde?: restate.Serde<T>
  ): Operation<void> {
    return lift(() => {
      this.restateContext
        .invocation(restate.InvocationIdParser.fromString(invocationId))
        .signal(name, serde)
        .resolve(payload);
    })();
  }

  rejectSignal(
    name: string,
    invocationId: string,
    reason: string | restate.TerminalError
  ): Operation<void> {
    return lift(() => {
      this.restateContext
        .invocation(restate.InvocationIdParser.fromString(invocationId))
        .signal(name)
        .reject(reason);
    })();
  }

  rejectAwakeable(
    id: string,
    reason: string | restate.TerminalError
  ): Operation<void> {
    return lift(() => {
      this.restateContext.rejectAwakeable(id, reason);
    })();
  }

  sleep(duration: restate.Duration | number, name?: string): Operation<void> {
    return this.bridge<void>(() => this.restateContext.sleep(duration, name));
  }

  genericCall<
    REQ = Uint8Array<ArrayBufferLike>,
    RES = Uint8Array<ArrayBufferLike>,
  >(call: restate.GenericCall<REQ, RES>): restate.InvocationPromise<RES> {
    return this.restateContext.genericCall(call);
  }

  genericSend<REQ = Uint8Array<ArrayBufferLike>>(
    call: restate.GenericSend<REQ>
  ): Operation<restate.InvocationHandle> {
    return lift(() => this.restateContext.genericSend(call))();
  }

  request(): restate.Request {
    return this.restateContext.request();
  }

  cancel(invocationId: restate.InvocationId): Operation<void> {
    return lift(() => {
      this.restateContext.cancel(invocationId);
    })();
  }
  attach<T>(
    invocationId: restate.InvocationId,
    serde?: restate.Serde<T>
  ): Operation<T> {
    return this.bridge<T>(() =>
      this.restateContext.attach(invocationId, serde)
    );
  }
}

function createContext(ctx: restate.Context): EffectionContext {
  return new EffectionContext(
    ctx as restate.internal.ContextInternal,
    restate.createDynamicPromise(ctx)
  );
}

function effectHandler<I, O>(
  handler: (ctx: EffectionContext, input: I) => Operation<O>
) {
  return async (ctx: restate.Context, input: I) => {
    const effectionContext = createContext(ctx);
    const rootPromise = effectionContext.rootPromise;

    run(function* () {
      const res = yield* handler(effectionContext, input);
      return res;
    })
      .then((value) => {
        rootPromise.resolve(value);
      })
      .catch((error) => {
        rootPromise.reject(error);
      });

    return await rootPromise;
  };
}

const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: effectHandler(function* (ctx, name: string) {
      let chunks = createChannel();

      yield* spawn(function* () {
        while (true) {
          const chunk = yield* ctx.signal<{ done: boolean; value: string }>(
            "chunks"
          );
          if (chunk.done) {
            yield* chunks.close();
            break;
          }
          yield* chunks.send(chunk);
        }
      });

      yield* ctx.genericSend({
        service: "greeter",
        method: "callLLM",
        parameter: new TextEncoder().encode(JSON.stringify(ctx.request().id)),
      });

      for (let value of yield* each(chunks)) {
        console.log("got value:", value);
        yield* each.next();
      }

      return `Hello!`;
    }),

    callLLM: effectHandler(function* (ctx, id: string) {
      yield* ctx.sleep(1000);
      yield* ctx.resolveSignal("chunks", id, {
        done: false,
        value: "This is a chunk",
      });
      yield* ctx.sleep(1000);
      yield* ctx.resolveSignal("chunks", id, {
        done: false,
        value: "This is the last chunk",
      });
      yield* ctx.resolveSignal("chunks", id, {
        done: true,
      });
      return "LLM call complete";
    }),
  },
});

restate.serve({ services: [greeter] });
