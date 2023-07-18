"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Failure } from "../generated/proto/protocol";
import { printMessageAsJson } from "../utils/utils";
import { Message } from "./types";
import { JournalEntry } from "../journal";

export enum ErrorCodes {
  INTERNAL = 13,
  JOURNAL_MISMATCH = 32,
  PROTOCOL_VIOLATION = 33,
}

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
    const msg = logPrefix
      ? `${logPrefix}  Uncaught exception for invocation id: ${this.message}`
      : this.message;
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

  public static journalMismatch(
    journalIndex: number,
    replayMessage: Message,
    journalEntry: JournalEntry
  ) {
    const msg = `Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!
        The journal entry at position ${journalIndex} was:
        - In the user code: type: ${
          journalEntry.messageType
        }, message:${printMessageAsJson(journalEntry.message)}
        - In the replayed messages: type: ${
          replayMessage.messageType
        }, message: ${printMessageAsJson(replayMessage.message)}`;
    return new RetryableError(msg, ErrorCodes.JOURNAL_MISMATCH);
  }

  public static protocolViolation(message: string) {
    return new RetryableError(message, ErrorCodes.PROTOCOL_VIOLATION);
  }

  public static apiViolation(message: string) {
    return new RetryableError(
      `API violation (${ErrorCodes.INTERNAL}): ${message}`
    );
  }

  public static fromError(e: Error) {
    return new RetryableError(e.message);
  }
}
