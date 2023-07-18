"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Failure } from "../generated/proto/protocol";

export function ensureError(e: unknown): Error {
  if (e instanceof Error) {
    return e;
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
  constructor(
    public readonly message: string,
    public readonly code: number = 13,
    public readonly cause?: any
  ) {
    super(message);
  }

  public hasCause(): boolean {
    return this.cause;
  }

  public getRestateRootCause(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let curr = this;
    while (curr instanceof RestateError && (curr as RestateError).cause) {
      curr = (curr as RestateError).cause;
    }
    return curr;
  }

  public toFailure(logPrefix?: string): Failure {
    const msg = logPrefix ?
      `${logPrefix}  Uncaught exception for invocation id: ${this.message}` :
      this.message
    return Failure.create({
      code: this.code,
      message: msg,
    });
  }
}

// Does not lead to Restate retries
// Leads to an output message with a failure defined
export class TerminalError extends RestateError {
  constructor(
    public readonly message: string,
    public readonly code: number = 13,
    public readonly cause?: any
  ) {
    super(message);
  }
}

// Leads to Restate retries
export class RetryableError extends RestateError {
  constructor(
    public readonly message: string,
    public readonly code: number = 13,
    public readonly cause?: any
  ) {
    super(message);
  }
}

export class JournalMismatchError extends RetryableError {
  constructor(public readonly message: string, public readonly cause?: any) {
    super(message, 32, cause);
  }
}

export class ProtocolViolationError extends RetryableError {
  constructor(public readonly message: string, public readonly cause?: any) {
    super(message, 33, cause);
  }
}

// We need this as a separate class for type matching for side effects
export class ApiViolationError extends RetryableError {
  constructor(public readonly message: string, public readonly cause?: any) {
    const code = 13;
    super(`API violation (${code}): ${message}`, code, cause);
  }
}

export function toRetryableError(e: Error){
  return new RetryableError(e.message);
}