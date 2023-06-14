"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  constructor(public readonly message: string, public readonly cause?: any) {
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
}
