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

// The engine tests predate connect() and spell the identity out as separate
// fields. They go through the real connectTunnel() adapter from
// @restatedev/restate-sdk-tunnel (imported from source, so the tests stay on
// the SDK source too), which turns those fields into connect() options.

import { connect } from "../../src/endpoint/connect/index.js";
import type { Connection } from "../../src/endpoint/tunnel/types.js";
import {
  toConnectOptions,
  type ConnectTunnelOptions,
} from "../../../restate-sdk-tunnel/src/adapt.js";

export type { ConnectTunnelOptions };

export function connectTunnel(options: ConnectTunnelOptions): Connection {
  return connect(toConnectOptions(options));
}
