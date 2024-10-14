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

/* eslint-disable @typescript-eslint/no-explicit-any */

export const INTERNAL_ERROR_CODE = 500;
export const TIMEOUT_ERROR_CODE = 408;
export const UNKNOWN_ERROR_CODE = 500;

// From shared core!
export const SUSPENDED_ERROR_CODE = 599;

export function ensureError(e: unknown): Error {
  if (e instanceof Error) {
    return e;
  }
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    // This is an error from the VM
    return new RestateError(e.message as string, {
      errorCode: e.code as number,
    });
  }

  let msg;
  try {
    msg = JSON.stringify(e);
  } catch (x) {
    msg = "(no JSON representation)";
  }

  return new Error("Non-Error value: " + msg);
}

export class RestateError extends Error {
  public readonly code: number;

  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, { cause: options?.cause });
    this.code = options?.errorCode ?? INTERNAL_ERROR_CODE;
  }
}

// Does not lead to Restate retries
// Leads to an output message with a failure defined
export class TerminalError extends RestateError {
  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, options);
  }
}

export class TimeoutError extends TerminalError {
  constructor() {
    super("Timeout occurred", { errorCode: TIMEOUT_ERROR_CODE });
  }
}
