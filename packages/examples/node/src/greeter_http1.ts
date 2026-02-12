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

import * as http from "node:http";
import {
  createEndpointHandler,
  service,
  type Context,
} from "@restatedev/restate-sdk";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      return `Hello ${name}`;
    },
  },
});

const port = parseInt(process.env.PORT ?? "9080");

const server = http.createServer(
  createEndpointHandler({ services: [greeter] })
);

server.listen(port, () => {
  console.log(`Restate HTTP/1.1 server listening on port ${port}`);
});
