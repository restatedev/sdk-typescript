import {
  CompletablePromise,
  wrapDeeply,
  WrappedPromise,
} from "./utils/promises";

export enum PromiseType {
  JournalEntry,
  // Combinator?,
  // SideEffect?
}

export interface PromiseId {
  type: PromiseType;
  id: number;
}

export function newJournalEntryPromiseId(entryIndex: number): PromiseId {
  return {
    type: PromiseType.JournalEntry,
    id: entryIndex,
  };
}

/**
 * Prepare a Promise combinator
 *
 * @param combinatorIndex the index of this combinator
 * @param combinatorConstructor the function that creates the combinator promise, e.g. Promise.all/any/race/allSettled
 * @param promises the promises given by the user, and the respective ids
 * @param readReplayOrder the function to read the replay order
 * @param onNewCompleted callback when a child entry is resolved
 * @param onCombinatorResolved callback when the combinator is resolved
 * @param onCombinatorReplayed callback when the combinator is replayed
 */
function preparePromiseCombinator(
  combinatorIndex: number,
  combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
  promises: Array<{ id: PromiseId; promise: Promise<any> }>,
  readReplayOrder: (combinatorIndex: number) => PromiseId[] | undefined,
  onNewCompleted: (combinatorIndex: number, promiseId: PromiseId) => void,
  onCombinatorResolved: (combinatorIndex: number) => void,
  onCombinatorReplayed: (combinatorIndex: number) => void
): WrappedPromise<any> {
  // Create the proxy promises and index them
  const promisesWithProxyPromise = promises.map((v) => ({
    id: v.id,
    originalPromise: v.promise,
    proxyPromise: new CompletablePromise<any>(),
  }));
  const promisesMap = new Map(
    promisesWithProxyPromise.map((v) => [
      // We need to define a key format for this map...
      v.id.type.toString() + "-" + v.id.id.toString(),
      { originalPromise: v.originalPromise, proxyPromise: v.proxyPromise },
    ])
  );

  // Create the combinator using the proxy promises
  const combinator = combinatorConstructor(
    promisesWithProxyPromise.map((v) => v.proxyPromise.promise)
  ).finally(() =>
    // Once the combinator is resolved, notify back.
    onCombinatorResolved(combinatorIndex)
  );

  return wrapDeeply(combinator, () => {
    const replayOrder = readReplayOrder(combinatorIndex);

    if (replayOrder === undefined) {
      // We're in processing mode! We need to wire up original promises with proxy promises
      for (const {
        originalPromise,
        proxyPromise,
        id,
      } of promisesWithProxyPromise) {
        originalPromise
          // This code works deterministically because the javascript runtime will enqueue
          // the listeners of the proxy promise (which are mounted in Promise.all/any) in a single FIFO queue,
          // so a subsequent resolve on another proxy promise can't overtake this one.
          //
          // Some resources:
          // * https://stackoverflow.com/questions/38059284/why-does-javascript-promise-then-handler-run-after-other-code
          // * https://262.ecma-international.org/6.0/#sec-jobs-and-job-queues
          // * https://tr.javascript.info/microtask-queue
          .then(
            (v) => {
              onNewCompleted(combinatorIndex, id);
              proxyPromise.resolve(v);
            },
            (e) => {
              onNewCompleted(combinatorIndex, id);
              proxyPromise.reject(e);
            }
          );
      }
      return;
    }

    // We're in replay mode, Now follow the replayIndexes order.
    onCombinatorReplayed(combinatorIndex);
    for (const promiseId of replayOrder) {
      // These are already completed, so once we set the then callback they will be immediately resolved.
      const { originalPromise, proxyPromise } = promisesMap.get(
        promiseId.type.toString() + "-" + promiseId.id.toString()
      )!;

      // Because this promise is already completed, promise.then will immediately enqueue in the promise microtask queue
      // the handlers to execute.
      // See the comment below for more details.
      originalPromise.then(
        (v) => proxyPromise.resolve(v),
        (e) => proxyPromise.reject(e)
      );
    }
  });
}

/**
 * This class takes care of creating and managing deterministic promise combinators.
 *
 * It should be wired up to the journal/state machine methods to read and write entries.
 */
export class PromiseCombinatorTracker {
  private nextCombinatorIndex = 0;
  private pendingCombinators: Map<number, PromiseId[]> = new Map();

  constructor(
    private readonly readReplayOrder: (
      combinatorIndex: number
    ) => PromiseId[] | undefined,
    private readonly onWriteCombinatorOrder: (
      combinatorIndex: number,
      order: PromiseId[]
    ) => void
  ) {}

  public createCombinator(
    combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
    promises: Array<{ id: PromiseId; promise: Promise<any> }>
  ): WrappedPromise<any> {
    const combinatorIndex = this.nextCombinatorIndex;
    this.nextCombinatorIndex++;

    // Prepare combinator order
    this.pendingCombinators.set(combinatorIndex, []);

    return preparePromiseCombinator(
      combinatorIndex,
      combinatorConstructor,
      promises,
      this.readReplayOrder,
      this.appendOrder.bind(this),
      this.onCombinatorResolved.bind(this),
      this.onCombinatorReplayed.bind(this)
    );
  }

  private appendOrder(idx: number, promiseId: PromiseId) {
    const order = this.pendingCombinators.get(idx);
    if (order === undefined) {
      // The order was already published, nothing to do here.
      return;
    }

    order.push(promiseId);
  }

  private onCombinatorReplayed(idx: number) {
    // This avoids republishing the order
    this.pendingCombinators.delete(idx);
  }

  private onCombinatorResolved(idx: number) {
    const order = this.pendingCombinators.get(idx);
    if (order === undefined) {
      // It was already published
      return;
    }

    // We don't need this list anymore.
    this.pendingCombinators.delete(idx);

    // Publish the combinator order
    this.onWriteCombinatorOrder(idx, order);
  }
}
