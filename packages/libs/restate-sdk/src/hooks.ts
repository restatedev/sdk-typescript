import {TerminalError} from "./types/errors.js";
import {Request} from "./context.js";

export type AttemptResult = {
    type: "success"
} | {
    type: "retryableError"
    error: Error
} | {
    type: "terminalError"
    error: TerminalError
}

export type Hooks = {
    // Set this hook to wrap the handler execution. Calling handlerRunner will cause the handler to run.
    // Use it to propagate an async context storage.
    wrapHandler?: (handlerRunner: () => Promise<void>) => Promise<void>;

    // Set this hook to wrap all ctx.run executions. Calling runRunner will cause the ctx.run closure to run.
    // Use it to propagate an async context storage.
    wrapRun?: (name: string, runRunner: () => Promise<void>) => Promise<void>;

    // Called when the attempt completes. Errors thrown inside this function are not propagated back to restate
    onAttemptEnd?: (result: AttemptResult) => void;
};

// If the hook provider fails, the same rules as handler failures apply:
// * if fails with terminal error, invocation is terminated with terminal error
// * for other failures, it gets retried
export type HooksProvider = (ctx: {
    request: Request;
}) => Hooks;