import * as restate from "@restatedev/restate-sdk";

// ----------------------------------------------------------------------------
//  types
// ----------------------------------------------------------------------------

export type Workflow<T> = {
    id: string,
    serviceName: string,
    method: string,
    keyParam?: string,
    valueParam?: T
}

// ----------------------------------------------------------------------------
//  public interface
// ----------------------------------------------------------------------------

async function submitAndGet<R, T>(ctx: restate.RpcContext, workflow: Workflow<T>): Promise<R> {
    const awakeable = ctx.awakeable<R>();

    const shouldSubmit = await ctx.rpc(internalStatusTrackerApi).addPromise(workflow.id, { workflow, awakeableId: awakeable.id})
    if (shouldSubmit) {
        const client = ctx.rpc<any>({path: workflow.serviceName});
        let result: R;
        if (workflow.keyParam !== undefined) {
            result = await client[workflow.method](workflow.keyParam, workflow.valueParam);
        } else {
            result = await client[workflow.method](workflow.valueParam);
        }
        ctx.send(internalStatusTrackerApi).completeAllPromises(workflow.id, result);
        return result;
    } else {
        const result = await awakeable.promise;
        return result;
    }
}

const durableSubmitterRouter = restate.router({
    submitAndGet
})

export type durableSubmitterApi = typeof durableSubmitterRouter;
export const durableSubmitterApiOpts: restate.ServiceApi<durableSubmitterApi> = { path: "Submitter" };


// ----------------------------------------------------------------------------
//   internal stuff 
// ----------------------------------------------------------------------------

const promisesStateName = "promises"
const resultStateName = "result"
const retentionTimeMillis = 60 * 60 * 1000;

async function addPromise<T, R>(ctx: restate.RpcContext, _workflowId: string, request: {
    workflow: Workflow<T>,
    awakeableId: string
}): Promise<boolean> {
    const result: R | null = await ctx.get(resultStateName);

    // result may already be here, if this is a repeated call. we fulfill eagerly in that case
    if (result !== null) {
        ctx.completeAwakeable(request.awakeableId, result);
        return false;
    }

    const promises: string[] = (await ctx.get(promisesStateName)) ?? [];
    promises.push(request.awakeableId);
    ctx.set(promisesStateName, promises);

    return promises.length === 1;
}

async function completeAllPromises(ctx: restate.RpcContext, workflowId: string, result: unknown) {
    // remember this for calls that come late
    ctx.set(resultStateName, result);
    ctx.sendDelayed(internalStatusTrackerApi, retentionTimeMillis).clearCachedResult(workflowId);

    // complete all pending awakables
    const promiseIds: string[] = (await ctx.get(promisesStateName)) ?? []
    for (const promiseId of promiseIds) {
        ctx.completeAwakeable(promiseId, result);
    }
    ctx.clear(promisesStateName);
}

async function clearCachedResult(ctx: restate.RpcContext) {
    ctx.clear(resultStateName);
}

const internalStatusTracker = restate.keyedRouter({
    addPromise,
    completeAllPromises,
    clearCachedResult
})

const internalStatusTrackerApi: restate.ServiceApi<typeof internalStatusTracker> = {
    path: "restate.submitter.internal.StatusTracker"
}

// ----------------------------------------------------------------------------
//   registration
// ----------------------------------------------------------------------------

export function addDurableSubmitter(server: restate.RestateServer | restate.LambdaRestateServer) {
    if (server instanceof restate.RestateServer) {
        const restateServer = server as restate.RestateServer;
        restateServer.bindKeyedRouter(internalStatusTrackerApi.path, internalStatusTracker);
        restateServer.bindRouter(durableSubmitterApiOpts.path, durableSubmitterRouter);

    } else if (server instanceof restate.LambdaRestateServer) {
        const lambdaHandler = server as restate.LambdaRestateServer;
        lambdaHandler.bindKeyedRouter(internalStatusTrackerApi.path, internalStatusTracker);
        lambdaHandler.bindRouter(durableSubmitterApiOpts.path, durableSubmitterRouter);
    }
}