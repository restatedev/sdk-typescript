/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { ensureError } from "../../types/errors.js";
import type { RestateHandler } from "./types.js";
import {
  captureHead,
  emptyInputReader,
  tryCreateContextualLogger,
} from "./utils.js";

export function fetcher(handler: RestateHandler) {
  return {
    fetch: (event: Request, ...extraArgs: unknown[]): Promise<Response> => {
      const url = event.url;
      const headers = Object.fromEntries(event.headers.entries());

      // handle should never throw
      const response = handler.handle({
        url,
        headers,
        extraArgs,
      });

      const inputReader = event.body
        ? event.body[Symbol.asyncIterator]()
        : emptyInputReader();

      // We use the TransformStream here to adapt writer -> reader
      const transformStream = new TransformStream<Uint8Array>();
      const outputWriter = transformStream.writable.getWriter();

      const { writeHead, head } = captureHead();
      // Request.signal is not portable as an attempt-completed signal. Bun,
      // Hono's Node adapter, Cloudflare Workers/Miniflare, and Vercel/Next do
      // not abort it after a successful response; Deno does, but that is
      // runtime-specific. Own the signal and abort it when processing finishes.
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      if (event.signal.aborted) {
        abort();
      } else {
        event.signal.addEventListener("abort", abort, { once: true });
      }

      response
        .process({
          inputReader,
          outputWriter,
          writeHead,
          abortSignal: abortController.signal,
        })
        .catch((e) => {
          // Responses handle their own errors before rejecting; anything
          // reaching here is an unexpected failure — just log.
          const error = ensureError(e);
          const logger =
            tryCreateContextualLogger(
              handler.endpoint.loggerTransport,
              url,
              headers
            ) ?? handler.endpoint.rlog;
          logger.error("Unexpected error: " + (error.stack ?? error.message));
        })
        .finally(() => {
          event.signal.removeEventListener("abort", abort);
          abort();
        });

      return head.then(
        (h) =>
          new Response(transformStream.readable, {
            status: h.statusCode,
            headers: h.headers,
          })
      );
    },
  };
}
