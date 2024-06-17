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

import type { ExportedHandler, Request } from "@cloudflare/workers-types";
import { Response } from "@cloudflare/workers-types";
import type { GenericHandler, RestateRequest } from "./generic";

export class CloudflareHandler implements ExportedHandler {
  constructor(private readonly handler: GenericHandler) {}

  async fetch(event: Request): Promise<Response> {
    const url = event.url;
    const requestBody: Uint8Array = new Uint8Array(await event.arrayBuffer());
    const headers = Object.fromEntries(event.headers.entries());
    const request: RestateRequest = {
      url,
      headers,
      body: requestBody,
    };

    const resp = await this.handler.handle(request);

    return new Response(resp.body, {
      status: resp.statusCode,
      headers: resp.headers,
    });
  }
}
