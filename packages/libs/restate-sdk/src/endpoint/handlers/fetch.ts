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

import type { GenericHandler, RestateRequest } from "./generic.js";

export function fetcher(handler: GenericHandler) {
  return {
    fetch: async (
      event: Request,
      ...extraArgs: unknown[]
    ): Promise<Response> => {
      const url = event.url;
      const headers = Object.fromEntries(event.headers.entries());

      const request: RestateRequest = {
        url,
        headers,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        body: event.body as any,
        extraArgs,
        abortSignal: event.signal,
      };

      const resp = await handler.handle(request);

      return new Response(resp.body as BodyInit | null | undefined, {
        status: resp.statusCode,
        headers: resp.headers,
      });
    },
  };
}
