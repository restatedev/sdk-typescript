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

/* eslint-disable no-console */

import express, { Request, Response } from "express";
import * as restate from "../src/public_api";

const rs = restate.connection("http://127.0.0.1:8080");

const app = express();
app.use(express.json());

app.post("/workflow", async (req: Request, res: Response) => {
  const { id } = req.body;

  const response = await rs.invoke(id, {}, async (ctx) => {
    // You can use all RestateContext features here (except sleep)

    const response = await ctx.sideEffect(async () => {
      return (await fetch("https://dummyjson.com/products/1")).json();
    });

    return response.title;
  });

  res.send(response);
});

app.listen(3000);
