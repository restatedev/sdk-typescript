// Test seam — NOT part of the public API.
//
// Anything in here is implementation that tests use directly. It's
// deliberately not re-exported from `index.ts`, and tsdown only bundles
// `index.ts`, so none of these names appear in the published `dist/`.
//
// Import via the relative path `../src/internal.js` from inside the
// package (tests, benchmarks). External consumers do not get access.

export { Scheduler } from "./scheduler.js";
export { defaultLib } from "./default-lib.js";
export type { Awaitable, AwaitableLib } from "./awaitable.js";
