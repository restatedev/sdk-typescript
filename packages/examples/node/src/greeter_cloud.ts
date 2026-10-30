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

// Serve against Restate Cloud with zero code changes.
//
//   restate cloud login          # once per machine
//   restate cloud link           # once per project: writes ./.env (see .env.example)
//   pnpm cloud                   # this file: serve() finds ./.env and connects
//   restate deployments register tunnel://<name>   # printed by the SDK
//
// Without a ./.env (or the RESTATE_* variables) the very same call listens
// on PORT (default 9080), as for a local Restate server.

import * as restate from "@restatedev/restate-sdk";

const greeter = restate.service({
  name: "Greeter",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => `Hello ${name}!`,
  },
});

void restate.serve({ services: [greeter] });
