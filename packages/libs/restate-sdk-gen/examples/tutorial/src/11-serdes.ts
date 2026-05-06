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

import * as restate from "@restatedev/restate-sdk";
import { service, schemas, serdes } from "@restatedev/restate-sdk-gen";
import { z } from "zod";

const CreateUserReq = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  role: z.enum(["admin", "user"]).default("user"),
});

const CreateUserRes = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string(),
});

export const userService = service({
  name: "users",
  handlers: {
    create: schemas(
      { input: CreateUserReq, output: CreateUserRes },
      function* (req) {
        return {
          id: `user`,
          username: req.username,
          role: req.role,
        };
      }
    ),
  },
});

export const echoService = service({
  name: "echo",
  handlers: {
    raw: serdes(
      { input: restate.serde.binary, output: restate.serde.binary },
      function* (bytes: Uint8Array) {
        return bytes;
      }
    ),
  },
});
