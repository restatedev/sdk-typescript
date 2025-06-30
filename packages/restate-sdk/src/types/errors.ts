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
export const CANCEL_ERROR_CODE = 409;
export const UNKNOWN_ERROR_CODE = 500;

// From shared core!
export const CLOSED_ERROR_CODE = 598;
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

export function logError(log: Console, e: unknown) {
  if (e instanceof RestateError) {
    if (e.code === SUSPENDED_ERROR_CODE) {
      log.info("Invocation suspended");
      return;
    } else if (e.code === CLOSED_ERROR_CODE) {
      log.error(
        "DANGER! The invocation is closed, but some related operation is still running. \n" +
          "This might indicate that a RestatePromise is being awaited on an asynchronous task, outside the handler, or you're awaiting a RestatePromise inside a ctx.run.\n" +
          "This is dangerous, and can lead the service to deadlock. Please fix the issue.\n" +
          "Diagnostic: ",
        e
      );
      return;
    }
  }
  log.warn("Error when processing a Restate context operation.\n", e);
}

export class RestateError extends Error {
  public readonly code: number;
  public name = "RestateError";

  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, { cause: options?.cause });
    this.code = options?.errorCode ?? INTERNAL_ERROR_CODE;
  }
}

/**
 * Does not lead to Restate retries.
 *
 * Leads to an output message with a failure defined.
 */
export class TerminalError extends RestateError {
  public name = "TerminalError";

  constructor(
    message: string,
    options?: {
      /**
       * Error code. This should be an HTTP status code, and in case the service was invoked from the ingress, this will be propagated back to the caller.
       */
      errorCode?: number;
      /**
       * @deprecated YOU MUST NOT USE THIS FIELD, AS IT WON'T BE RECORDED AND CAN LEAD TO NON-DETERMINISM! From the next SDK version, the constructor won't accept this field anymore.
       */
      cause?: any;
    }
  ) {
    super(message, options);
  }
}

/**
 * Returned by `RestatePromise.withTimeout` when the timeout is reached.
 */
export class TimeoutError extends TerminalError {
  public name = "TimeoutError";

  constructor() {
    super("Timeout occurred", { errorCode: TIMEOUT_ERROR_CODE });
  }
}

/**
 * Returned when the invocation was cancelled.
 */
export class CancelledError extends TerminalError {
  public name = "CancelledError";

  constructor() {
    super("Cancelled", { errorCode: CANCEL_ERROR_CODE });
  }
}
