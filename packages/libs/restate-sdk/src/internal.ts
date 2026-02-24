import { Context } from "./context.js";

/**
 * Internal {@link Context} interface exposing additional features.
 *
 * Please note that this API is to be considered experimental and might change without notice.
 *
 * @experimental
 */
export interface ContextInternal extends Context {
  /**
   * Returns true if the handler is in the processing phase.
   * This is the mechanism used by `ctx.console` to distinguish whether we should log or not in replaying/processing.
   *
   * **WARNING**: This method should not be used to influence control flow, as it will **surely** lead to non-determinism errors!
   *
   * @experimental
   */
  isProcessing(): boolean;
}
