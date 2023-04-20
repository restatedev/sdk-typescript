"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
