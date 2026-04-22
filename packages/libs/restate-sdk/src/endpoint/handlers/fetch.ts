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

      response
        .process({
          inputReader,
          outputWriter,
          writeHead,
          abortSignal: event.signal,
        })
        .catch((e) => {
          // wrapResponseWithSafety guarantees writeHead is called and
          // closes the output stream; anything reaching here is a
          // post-commit error.
          const error = ensureError(e);
          const logger =
            tryCreateContextualLogger(
              handler.endpoint.loggerTransport,
              url,
              headers
            ) ?? handler.endpoint.rlog;
          logger.error("Unexpected error: " + (error.stack ?? error.message));
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
