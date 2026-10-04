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

import { serve } from "@restatedev/restate-sdk";
import { session } from "./session.js";
import { taskRunner } from "./runner.js";

serve({
  services: [session, taskRunner],
  port: parseInt(process.env.PORT ?? "9080"),
});
