import * as restate from "@restatedev/restate-sdk/fetch";
import { greeter } from "@/restate/greeter";

const endpoint = restate.createEndpointHandler({ services: [greeter] });

export const GET = endpoint;
export const POST = endpoint;
