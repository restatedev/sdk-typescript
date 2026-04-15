import {
  createWorkflowHandler,
  RestatePromise,
  serve,
  TerminalError,
  workflow,
  WorkflowContext,
  WorkflowSharedContext,
  InvocationId,
  object,
  ObjectContext,
} from "@restatedev/restate-sdk";

type Chunk = {
  type: string;
  tool: string;
  args: any;
};

/**
 * This simulate an ongoing call to a model proxy that produces chunks of data (e.g. tool calls) as the model generates its response.
 */
async function* modelProxyCall(
  turn: string,
  signal: AbortSignal
): AsyncGenerator<Chunk> {
  const chunks: Array<Chunk> = [
    {
      type: "tool.call",
      tool: "search",
      args: { query: "What is the capital of France?" },
    },
    {
      type: "tool.call",
      tool: "search",
      args: { query: "What is the population of France?" },
    },
    {
      type: "tool.call",
      tool: "search",
      args: { query: "What is the largest city in France?" },
    },
  ];

  const attemptAbort = new Promise((_, rej) =>
    signal.addEventListener("abort", () => rej(new Error("Aborted")))
  );

  for (const chunk of chunks) {
    // simulate a network call
    await Promise.race([
      new Promise((res) => setTimeout(res, 20_000)),
      attemptAbort,
    ]);
    yield chunk;
  }
}

/***
 * This workflow simulates a long-running generator of chunks, that could represent tool calls produced by a language model as it generates its response.
 * The workflow produces chunks one by one, and the client can consume them as they are produced, without having to wait for the entire generation process to complete.
 * The client can also cancel the generation process, which will stop the workflow and prevent any further chunks from being produced.
 *
 * NOTE: since the model proxy is non-deterministic there is no point in retrying the workflow
 */
export const llmGenerator = workflow({
  name: "LLMGenerator",
  handlers: {
    run: createWorkflowHandler(
      {
        retryPolicy: {
          maxAttempts: 1, // never retry
          onMaxAttempts: "kill", // kill the workflow on max attempts
        },
        journalRetention: { hours: 0 },
        inactivityTimeout: { hours: 2 },
        abortTimeout: { hours: 2 },
      },
      async (ctx: WorkflowContext, turn: string) => {
        const signal = ctx.request().attemptCompletedSignal;
        const modelProxy = modelProxyCall(turn, signal);

        try {
          let chunkIndex = 0;

          while (true) {
            const { done, value } = await modelProxy.next();
            if (done) break;
            await ctx.promise<Chunk>(`chunk-${chunkIndex}`).resolve(value);
            chunkIndex++;
          }
        } catch (error) {
          if (error instanceof TerminalError) {
            throw error;
          }
          // transient error proxying chunks from the model
          throw new TerminalError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    ),

    getChunk: async (ctx: WorkflowSharedContext, chunkIndex: number) => {
      return await ctx.promise<Chunk>(`chunk-${chunkIndex}`).get();
    },

    tryGetChunk: async (ctx: WorkflowSharedContext, chunkIndex: number) => {
      return await ctx.promise<Chunk>(`chunk-${chunkIndex}`).peek();
    },
  },
});

///
/// Below is an example of how a client (e.g. an agent) could consume the chunks produced by the llmGenerator workflow,
//  as they are produced, without having to wait for the entire generation process to complete.
///

type GeneratorState =
  | {
      state: "running";
      generatorId: string;
      workflowInvocationId: InvocationId;
      chunkIndex: number;
    }
  | { state: "draining"; generatorId: string; chunkIndex: number }
  | { state: "drained" };

async function next(
  ctx: ObjectContext,
  state: GeneratorState
): Promise<{ chunk?: Chunk; state: GeneratorState }> {
  if (state.state === "drained") {
    // the generator has finished, and we've already consumed all the chunks that
    // it produced.
    // nothing more to do.
    return { chunk: undefined, state };
  }

  // if we're here, the generator is either still running, or it's finished but we haven't consumed all the chunks yet.
  // in both cases, we try to get the next chunk.
  // if the generator is still running, we wait for either the next chunk to be produced, or for the workflow to complete
  // (which means that the generator has finished producing chunks).
  const workflow = ctx.workflowClient(llmGenerator, state.generatorId);
  let currentState = state;

  if (state.state === "running") {
    const chunk = workflow
      .getChunk(state.chunkIndex)
      .map((chunk) => ({ type: "chunk", chunk }));
    const wfDone = ctx
      .attach(state.workflowInvocationId)
      .map(() => ({ type: "done", chunk: undefined }));
    const res = await RestatePromise.race([chunk, wfDone]);

    if (res.type === "chunk") {
      return {
        chunk: res.chunk,
        state: { ...state, chunkIndex: state.chunkIndex + 1 },
      };
    }

    // the workflow has completed, which means that the generator has finished producing chunks.
    // we might have already consumed all the produced chunks, or we might still have some chunks to consume.
    // let's switch to "draining" state, where we can only consume the remaining produced chunks, but we know that no new chunks will be produced.
    currentState = { ...state, state: "draining" };
  }

  const nextChunk = await workflow.tryGetChunk(currentState.chunkIndex);
  if (!nextChunk) {
    return { chunk: undefined, state: { state: "drained" } };
  }

  return {
    chunk: nextChunk,
    state: { ...currentState, chunkIndex: currentState.chunkIndex + 1 },
  };
}

// usage example

const agent = object({
  name: "Agent",
  handlers: {
    onStart: async (ctx: ObjectContext) => {
      const generatorId = ctx.rand.uuidv4();
      const workflowInvocationId = await ctx
        .workflowSendClient(llmGenerator, generatorId)
        .run("What is the capital of France?").invocationId;

      ctx.set<GeneratorState>("generator", {
        state: "running",
        generatorId,
        workflowInvocationId,
        chunkIndex: 0,
      });
    },

    onNext: async (ctx: ObjectContext) => {
      const state = await ctx.get<GeneratorState>("generator");

      if (!state) {
        throw new TerminalError("Generator not started");
      }

      const { chunk, state: nextState } = await next(ctx, state);

      ctx.console.log("Received chunk:", chunk!);
      ctx.set("generator", nextState);

      return chunk;
    },

    onCancel: async (ctx: ObjectContext) => {
      const state = await ctx.get<GeneratorState>("generator");
      if (!state) {
        return;
      }
      if (state.state === "running") {
        ctx.cancel(state.workflowInvocationId);
        ctx.clear("generator");
      }
    },
  },
});

serve({ services: [llmGenerator, agent] });
