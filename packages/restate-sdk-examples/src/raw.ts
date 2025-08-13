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

import { service, serve } from "@restatedev/restate-sdk";
import { serde } from "@restatedev/restate-sdk-core";

const rawService = service({
  name: "raw",
  handlers: {
    binary: {
      /**
       * Handlers can be configured to bypass JSON serialization,
       * by specifying the input (accept) and output (contentType) content types.
       *
       * To call this handler with binary data, you can use the following curl command:
       * curl -X POST -H "Content-Type: application/octet-stream" --data-binary 'hello' ${RESTATE_INGRESS_URL}/raw/binary
       */
      input: serde.binary,
      output: serde.binary,
      handler: async (ctx, data: Uint8Array) => {
        // console.log("Received binary data", data);
        return data;
      },
    },
  },
});

export type RawService = typeof rawService;

serve({ services: [rawService] });
