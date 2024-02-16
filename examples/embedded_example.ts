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

const router = restate.router({
  hello: (ctx: restate.Context, param: { productId: string }) =>
    ctx.sideEffect(() =>
      fetch(`https://dummyjson.com/products/${param.productId}`)
        .then((res) => res.json())
        .then((product) => product.title)
    ),
});

const routerApi: restate.ServiceApi<typeof router> = { path: "example" };

const rs = restate
  .endpoint()
  .bindRouter(routerApi.path, router)
  .connect("http://127.0.0.1:8080");

const app = express();
app.use(express.json());

app.post("/workflow", async (req: Request, res: Response) => {
  const { id } = req.body;

  const response = await rs
    .rpc(routerApi, { idempotencyKey: id, retain: 60 })
    .hello({ productId: id });
  res.send(response);
});

app.listen(3000);
