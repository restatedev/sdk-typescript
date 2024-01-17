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
 * Replay a Promise combinator
 *
 * @param combinatorIndex the index of this combinator
 * @param combinatorConstructor the function that creates the combinator promise, e.g. Promise.all/any/race/allSettled
 * @param promises the promises given by the user, and the respective ids
 * @param readReplayOrder the function to read the replay order
 */
function prepareReplayedPromiseCombinator(
  combinatorIndex: number,
  combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
  promises: Array<{ id: PromiseId; promise: Promise<any> }>,
  readReplayOrder: (combinatorIndex: number) => PromiseId[]
): WrappedPromise<any> {
  // Create the proxy promises and index them
  const promisesWithProxyPromise = promises.map((v) => ({
    id: v.id,
    promise: v.promise,
    proxyPromise: new CompletablePromise<any>(),
  }));
  const promisesMap = new Map(
    promisesWithProxyPromise.map((v) => [
      // We need to define a key format for this map...
      v.id.type.toString() + "-" + v.id.id.toString(),
      { promise: v.promise, proxyPromise: v.proxyPromise },
    ])
  );

  // Create the combinator
  const combinator = combinatorConstructor(
    promisesWithProxyPromise.map((v) => v.proxyPromise.promise)
  );

  return wrapDeeply(combinator, () => {
    // We read the replay order on the await point.
    // This is important because when writing the entry, we write it on the await point!
    const replayOrder = readReplayOrder(combinatorIndex);
    // Now follow the replayIndexes order
    for (const promiseId of replayOrder) {
      // These are already completed, so once we set the then callback they will be immediately resolved.
      const { promise, proxyPromise } = promisesMap.get(
        promiseId.type.toString() + "-" + promiseId.id.toString()
      )!!;

      // Because this promise is already completed, promise.then will immediately enqueue in the promise microtask queue
      // the handlers to execute.
      // See the comment below for more details.
      promise.then(
        (v) => proxyPromise.resolve(v),
        (e) => proxyPromise.reject(e)
      );
    }
  });
}

/**
 * Create a pending promise combinator
 *
 * @param combinatorIndex this is an index given by the state machine to this combinator. This is passed through to onCombinatorResolved, and can be used to establish an order between combinators (e.g. to make sure order entries are written in order)
 * @param combinatorConstructor the function that creates the combinator promise, e.g. Promise.all/any/race/allSettled
 * @param promisesWithIds the promises given by the user, and the respective entry indexes
 * @param onNewCompleted callback when a child entry is resolved
 * @param onCombinatorResolved callback when the combinator is resolved
 */
function createPromiseCombinator(
  combinatorIndex: number,
  combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
  promisesWithIds: Array<{ id: PromiseId; promise: Promise<any> }>,
  onNewCompleted: (combinatorIndex: number, promiseId: PromiseId) => void,
  onCombinatorResolved: (combinatorIndex: number) => void
): Promise<any> {
  // We still create a proxy promise as then of the child promises,
  // because we MUST make sure that onNewCompleted is executed before the promise registered in the combinator gets fulfilled.
  const proxyPromises = promisesWithIds.map((promiseWithId) =>
    // This code works deterministically because the javascript runtime will enqueue
    // the listeners of the proxy promise (which are mounted in Promise.all/any) in a single FIFO queue,
    // so a subsequent resolve on another proxy promise can't overtake this one.
    //
    // Some resources:
    // * https://stackoverflow.com/questions/38059284/why-does-javascript-promise-then-handler-run-after-other-code
    // * https://262.ecma-international.org/6.0/#sec-jobs-and-job-queues
    // * https://tr.javascript.info/microtask-queue
    promiseWithId.promise.finally(() =>
      onNewCompleted(combinatorIndex, promiseWithId.id)
    )
  );

  // Create the combinator
  return combinatorConstructor(proxyPromises).finally(() =>
    onCombinatorResolved(combinatorIndex)
  );
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
    private readonly readReplayOrder: (combinatorIndex: number) => PromiseId[],
    private readonly onWriteCombinatorOrder: (
      combinatorIndex: number,
      order: PromiseId[]
    ) => void
  ) {}

  public createCombinatorInReplayMode(
    combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
    promises: Array<{ id: PromiseId; promise: Promise<any> }>
  ): WrappedPromise<any> {
    const combinatorIndex = this.nextCombinatorIndex;
    this.nextCombinatorIndex++;

    return prepareReplayedPromiseCombinator(
      combinatorIndex,
      combinatorConstructor,
      promises,
      this.readReplayOrder
    );
  }

  public createCombinatorInProcessingMode(
    combinatorConstructor: (promises: PromiseLike<any>[]) => Promise<any>,
    promises: Array<{ id: PromiseId; promise: Promise<any> }>
  ): Promise<any> {
    const combinatorIndex = this.nextCombinatorIndex;
    this.nextCombinatorIndex++;

    // Prepare combinator order
    this.pendingCombinators.set(combinatorIndex, []);

    return createPromiseCombinator(
      combinatorIndex,
      combinatorConstructor,
      promises,
      this.appendOrder.bind(this),
      this.onCombinatorResolved.bind(this)
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

  private onCombinatorResolved(idx: number) {
    const order = this.pendingCombinators.get(idx);
    if (order === undefined) {
      throw new Error(
        "Unexpected onCombinatorResolved called with a combinator identifier not registered. This sounds like an implementation bug."
      );
    }

    // We don't need this list anymore.
    this.pendingCombinators.delete(idx);

    // Publish the combinator order
    this.onWriteCombinatorOrder(idx, order);
  }
}
