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
      ...extraArgs: object[]
    ): Promise<Response> => {
      const url = event.url;
      const headers = Object.fromEntries(event.headers.entries());

      const request: RestateRequest = {
        url,
        headers,
        body: event.body,
        extraArgs,
      };

      const resp = await handler.handle(request);

      return new Response(resp.body, {
        status: resp.statusCode,
        headers: resp.headers,
      });
    },
  };
}
