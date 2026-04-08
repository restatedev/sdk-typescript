// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk-clients";

export function getIngressUrl(): string {
  const url = process.env.RESTATE_INGRESS_URL;
  if (!url) {
    throw new Error("RESTATE_INGRESS_URL environment variable is not set");
  }
  return url.replace(/\/+$/, "");
}

export function getAdminUrl(): string {
  const url = process.env.RESTATE_ADMIN_URL;
  if (!url) {
    throw new Error("RESTATE_ADMIN_URL environment variable is not set");
  }
  return url.replace(/\/+$/, "");
}

export function ingressClient() {
  return restate.connect({ url: getIngressUrl() });
}
