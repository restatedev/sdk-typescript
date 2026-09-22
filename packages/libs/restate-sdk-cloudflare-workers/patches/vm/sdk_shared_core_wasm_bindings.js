// Cloudflare Workers compatibility shim.
//
// The real shared core is loaded (asynchronously) by `./index.js`. Two SDK files still import this
// module directly and synchronously, so we keep a tiny stable stand-in:
//   - `core_logging.js` reads `LogLevel` (the enum values are fixed: 0..4);
//   - `fetch.js` calls `cloudflareWorkersBundlerPatch()` (a no-op kept to defeat a CF bundler bug).

export const LogLevel = Object.freeze({
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
});

export function cloudflareWorkersBundlerPatch() {}
