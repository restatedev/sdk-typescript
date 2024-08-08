// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";

import "./awakeable_holder.js";
import "./counter.js";
import "./event_handler.js";
import "./list.js";
import "./map.js";
import "./cancel_test.js";
import "./non_determinism.js";
import "./failing.js";
import "./side_effect.js";
import "./workflow.js";
import "./proxy.js";
import "./test_utils.js";
import "./kill.js";

import { REGISTRY } from "./services.js";

if (!process.env.SERVICES) {
  throw new Error("Cannot find SERVICES env");
}
const fqdns = new Set(process.env.SERVICES.split(","));
const endpoint = restate.endpoint();
REGISTRY.register(fqdns, endpoint);

if (process.env.E2E_REQUEST_SIGNING) {
  endpoint.withIdentityV1(...process.env.E2E_REQUEST_SIGNING.split(","));
}
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  endpoint.listen().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
  });
}

export const handler = endpoint.lambdaHandler();
