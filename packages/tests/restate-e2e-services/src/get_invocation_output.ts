// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

/** JSON-friendly version of `restate.internal.InvocationOutput`, returned by the probe. */
export type ProbeResult =
  | { status: "running" }
  | { status: "success"; value: unknown }
  | {
      status: "failure";
      error: {
        message: string;
        code: number;
        metadata: Record<string, string>;
      };
    }
  // getInvocationOutput itself rejected
  | { status: "rejected"; message: string; code?: number };

const getInvocationOutputTest = restate.service({
  name: "GetInvocationOutputTest",
  handlers: {
    // ---- Targets ----

    /** Wait for the "done" signal, then return its value. */
    waitForSignal: async (ctx: restate.Context): Promise<string> => {
      return ctx.signal<string>("done");
    },

    /** Fail with a TerminalError carrying code and metadata. */
    fail: async (_ctx: restate.Context): Promise<string> => {
      throw new restate.TerminalError("boom", {
        errorCode: 418,
        metadata: { reason: "teapot" },
      });
    },

    /** Complete successfully with no output. */
    returnVoid: async (_ctx: restate.Context): Promise<void> => {},

    // ---- Probe ----

    /** Get the output of the target invocation, without waiting for it. */
    probe: async (
      ctx: restate.Context,
      invocationId: string
    ): Promise<ProbeResult> => {
      let output: restate.internal.InvocationOutput<unknown>;
      try {
        output = await restate.internal
          .asInternal(ctx)
          .getInvocationOutput(
            restate.InvocationIdParser.fromString(invocationId)
          );
      } catch (e) {
        if (e instanceof restate.TerminalError) {
          return { status: "rejected", message: e.message, code: e.code };
        }
        throw e;
      }
      switch (output.status) {
        case "running":
          return { status: "running" };
        case "success":
          return { status: "success", value: output.value };
        case "failure":
          return {
            status: "failure",
            error: {
              message: output.error.message,
              code: output.error.code,
              metadata: output.error.metadata ?? {},
            },
          };
      }
    },
  },
});

REGISTRY.addService(getInvocationOutputTest);

export type GetInvocationOutputTest = typeof getInvocationOutputTest;
