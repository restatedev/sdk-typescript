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

/*
 * A simple example program using the Restate's event handlers.
 */

import * as restate from "../src/public_api";

const registration = async (ctx: restate.RpcContext, event: restate.Event) => {
  // store in state the user's information as coming from the registeration event
  const { name } = event.json<{ name: string }>();
  ctx.set("name", name);
};

const email = async (ctx: restate.RpcContext, event: restate.Event) => {
  // store in state the user's information as coming from the email event
  const { email } = event.json<{ email: string }>();
  ctx.set("email", email);
};

type UserProfile = {
  id: string;
  name: string;
  email: string;
};

const get = async (
  ctx: restate.RpcContext,
  id: string
): Promise<UserProfile> => {
  return {
    id,
    name: (await ctx.get<string>("name")) ?? "",
    email: (await ctx.get<string>("email")) ?? "",
  };
};

const profile = restate.keyedRouter({
  registration: restate.keyedEventHandler(registration),
  email: restate.keyedEventHandler(email),
  get,
});

// restate server
restate.createServer().bindKeyedRouter("profile", profile).listen(9080);
