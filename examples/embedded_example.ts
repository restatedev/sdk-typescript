/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable no-console */

import express, { Request, Response } from "express";
import * as restate from "../src/public_api";

const rs = restate.connection({ ingress: "http://127.0.0.1:9090" });

const app = express();
app.use(express.json());

app.post("/workflow", async (req: Request, res: Response) => {
  const { id, name } = req.body;

  const response = await rs.invoke({
    id,
    input: name,
    handler: async (ctx, name) => {
      const p1 = await ctx.sideEffect(async () => `Hello ${name}!`);
      const p2 = await ctx.sideEffect(async () => `Bonjour ${name}`);
      const p3 = await ctx.sideEffect(async () => `Hi ${name}`);
      // const p4 = await ctx
      //   .rpc<{ greet: (name: string) => Promise<string> }>({ path: "greeter" })
      //   .greet(name);

      return p1 + p2 + p3; //+ p4;
    },
  });

  res.send(response);
});

app.listen(3000);
