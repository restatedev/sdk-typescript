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

import { describe, expect, test } from "vitest";
import { forwardedTail } from "../src/forwarded.js";

describe("forwardedTail", () => {
  // The stripped tail must be BYTE-EXACT: the SDK verifies the identity
  // JWT's aud (signed over the service-relative path) against it.
  test("strips the production shapes exactly", () => {
    expect(
      forwardedTail(
        "/https/my-svc.ns.svc.cluster.local/9080/invoke/Svc/handler"
      )
    ).toBe("/invoke/Svc/handler");
    expect(forwardedTail("/http/host/9080/discover")).toBe("/discover");
    expect(forwardedTail("/http/host/9080/health")).toBe("/health");
  });

  test("preserves the query string", () => {
    expect(forwardedTail("/http/h/1/invoke/S/h?a=b&c=d")).toBe(
      "/invoke/S/h?a=b&c=d"
    );
  });

  test("an empty tail maps to /", () => {
    expect(forwardedTail("/http/host/9080")).toBe("/");
  });

  test("does not normalize or re-encode the tail", () => {
    expect(forwardedTail("/http/h/1/invoke/My%20Svc/h")).toBe(
      "/invoke/My%20Svc/h"
    );
    expect(forwardedTail("/http/h/1/INVOKE/Svc/h")).toBe("/INVOKE/Svc/h");
  });

  test("rejects paths without the three-segment prefix", () => {
    expect(forwardedTail("/discover")).toBeNull();
    // A non-numeric third segment is not a port — this is an unprefixed SDK
    // path, not a forwarded one (scheme=invoke/host=Svc/port=handler would
    // silently dispatch `/`).
    expect(forwardedTail("/invoke/Svc/handler")).toBeNull();
    expect(forwardedTail("/")).toBeNull();
    expect(forwardedTail("")).toBeNull();
    expect(forwardedTail("/http//9080/x")).toBeNull();
    expect(forwardedTail("/http/host/notaport/x")).toBeNull();
  });
});
