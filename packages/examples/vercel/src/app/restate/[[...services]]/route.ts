import * as restate from "@restatedev/restate-sdk/fetch";
import { greeter } from "../../../restate/greeter.js";

const identityKeys =
  process.env.RESTATE_IDENTITY_KEYS?.split(",").filter(Boolean);

const endpoint = restate.createEndpointHandler({
  services: [greeter],
  identityKeys,
});

export const GET = endpoint;
export const POST = endpoint;
