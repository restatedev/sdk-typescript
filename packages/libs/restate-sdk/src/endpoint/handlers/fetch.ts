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
import { tryCreateContextualLogger } from "./utils.js";

export function fetcher(handler: RestateHandler) {
  return {
    fetch: (event: Request, ...extraArgs: unknown[]): Promise<Response> => {
      const url = event.url;
      const headers = Object.fromEntries(event.headers.entries());

      const transformStream = new TransformStream<Uint8Array>();
      const outputStream = transformStream.writable;

      const response = handler.handle({
        url,
        headers,
        extraArgs,
      });

      // Start processing, then return back the response
      response
        .process({
          inputStream: event.body ?? undefined,
          outputStream,
          abortSignal: event.signal,
        })
        .catch((e) => {
          // handle should never throw
          const error = ensureError(e);
          const logger =
            tryCreateContextualLogger(
              handler.endpoint.loggerTransport,
              url,
              headers
            ) ?? handler.endpoint.rlog;
          logger.error("Unexpected error: " + (error.stack ?? error.message));
        });

      return Promise.resolve(
        new Response(transformStream.readable, {
          status: response.statusCode,
          headers: response.headers,
        })
      );
    },
  };
}
