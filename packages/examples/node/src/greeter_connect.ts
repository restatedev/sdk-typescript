/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

// The greeter, connected to Restate Cloud instead of listening on a port.
//
//   export RESTATE_CONNECT_KEY=restate://…   # from the Cloud UI: Development → Configure SDK
//   pnpm greeter_connect
//   restate deployments register connect://greeter-v1   # printed by the SDK, once

import { service, connect, type Context } from "@restatedev/restate-sdk";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      return `Hello ${name}`;
    },
  },
});

connect({ services: [greeter], name: "greeter-v1" });
