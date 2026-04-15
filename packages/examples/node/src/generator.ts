import {
  service,
  serve,
  type Context,
  RestatePromise,
  TerminalError,
  workflow,
  WorkflowContext,
  WorkflowSharedContext,
} from "@restatedev/restate-sdk";
import { fi } from "zod/locales";

type GeneratorState<T, TReturn> =
  | { type: "open"; gen: AsyncGenerator<T, TReturn> }
  | { type: "closed" };

/**
 * A durable async generator that persists its state across restarts using Restate's durable execution.
 *
 * This wrapper makes any async generator durable by persisting side effects that occur during
 * the generator's execution. Each call to `next()` is wrapped in a durable context run,
 * ensuring that side effects are persisted and the generator state is maintained across
 * service restarts or failures.
 *
 * **Important**: This implementation does not resume the generator from where it left off.
 * Instead, it replays the previous generated values. This is useful for
 * generators that perform side effects (like sending messages or processing queue items)
 * where the generator represents a non-deterministic process that cannot be simply resumed.
 *
 * @example
 * ```typescript
 * async function* processItems() {
 *   const items = ['a', 'b', 'c'];
 *   for (const item of items) {
 *     // Side effect - this will be persisted
 *     yield item;
 *   }
 * }
 *
 * const durableGen = await DurableAsyncGenerator.create(ctx, processItems);
 * for await (const item of durableGen) {
 *   ctx.console.log(item); // Each log is persisted
 * }
 * ```
 *
 * @template T The type of values yielded by the generator
 * @template TReturn The type of the value returned when the generator completes
 */
export class DurableAsyncGenerator<T, TReturn = any> {
  public static create<T, TReturn = any>(
    context: Context,
    gen: () => AsyncGenerator<T, TReturn>
  ): RestatePromise<DurableAsyncGenerator<T, TReturn>> {
    const generator = new DurableAsyncGenerator<T, TReturn>(context);

    return context
      .run("create", async () => {
        generator.state = { type: "open", gen: gen() };
      })
      .map(() => generator);
  }

  private constructor(
    private readonly context: Context,
    private state: GeneratorState<T, TReturn> = { type: "closed" }
  ) {}

  next(): RestatePromise<IteratorResult<T, TReturn>> {
    return this.context.run("next", async () => {
      try {
        if (this.state.type !== "open") {
          throw new Error("Generator has been aborted");
        }
        return await this.state.gen.next();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new TerminalError(errorMessage);
      }
    });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => this.next(),
    };
  }
}

async function* randomGreeting() {
  const greetings = [
    "Hello",
    "Hi",
    "Greetings",
    "Salutations",
    "Howdy",
    "Hey there",
    "Good to see you",
    "Welcome",
    "Ahoy",
    "Yo",
  ];
  for (const greeting of greetings) {
    yield greeting;
  }
}

export const greeter = workflow({
  name: "LLMGenerator",
  handlers: {
    run: async (ctx: WorkflowContext, name: string) => {
      const generator = await DurableAsyncGenerator.create(ctx, randomGreeting);
      let index = 0;
      try {
        for await (const greeting of generator) {
          await ctx.promise(`chunk-${index}`).resolve(greeting);
          index++;
        }
      } catch (error) {}
      ctx.promise("done").resolve(true);
    },

    getChunk: async (ctx: WorkflowSharedContext, chunkIndex: number) => {
      return await ctx.promise(`chunk-${chunkIndex}`).get();
    },

    tryGetChunk: async (ctx: WorkflowSharedContext, chunkIndex: number) => {
      return await ctx.promise(`chunk-${chunkIndex}`).peek();
    },

    getChunkAlt: async (ctx: WorkflowSharedContext, chunkIndex: number) => {
      return await RestatePromise.race([
        ctx
          .promise(`chunk-${chunkIndex}`)
          .get()
          .map((value) => ({ done: false, value })),
        ctx
          .promise("done")
          .get()
          .map(() => ({ done: true, value: undefined })),
      ]);
    },
  },
});

export type Greeter = typeof greeter;
