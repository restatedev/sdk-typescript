"use strict";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Failure } from "../generated/proto/protocol";
import { printMessageAsJson } from "../utils/utils";
import { Message } from "./types";
import { JournalEntry } from "../journal";
import { FailureWithTerminal } from "../generated/proto/javascript";

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
  public readonly code: number;

  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, { cause: options?.cause });
    this.code = options?.errorCode ?? ErrorCodes.INTERNAL;
  }

  public toFailure(): Failure {
    return Failure.create({
      code: this.code,
      message: this.message,
    });
  }
}

// Does not lead to Restate retries
// Leads to an output message with a failure defined
export class TerminalError extends RestateError {
  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, options);
  }
}

// Leads to Restate retries
export class RetryableError extends RestateError {
  constructor(message: string, options?: { errorCode?: number; cause?: any }) {
    super(message, options);
  }

  public static internal(message: string) {
    return new RetryableError(message);
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
    return new RetryableError(msg, { errorCode: ErrorCodes.JOURNAL_MISMATCH });
  }

  public static protocolViolation(message: string) {
    return new RetryableError(message, {
      errorCode: ErrorCodes.PROTOCOL_VIOLATION,
    });
  }

  public static apiViolation(message: string) {
    return new RetryableError(`API violation: ${message}`, {
      errorCode: ErrorCodes.INTERNAL,
    });
  }
}

function isFailureWithTerminal(
  msg: Failure | FailureWithTerminal
): msg is FailureWithTerminal {
  return "failure" in msg;
}

export function errorToFailure(err: Error): Failure {
  return err instanceof RestateError
    ? err.toFailure()
    : Failure.create({
        code: ErrorCodes.INTERNAL,
        message: err.message,
      });
}

export function errorToFailureWithTerminal(err: Error): FailureWithTerminal {
  const failure = errorToFailure(err);
  return FailureWithTerminal.create({
    failure,
    terminal: err instanceof TerminalError,
  });
}

export function failureToError(msg: Failure | FailureWithTerminal): Error {
  let failure: Failure | undefined;
  let terminal: boolean;

  if (isFailureWithTerminal(msg)) {
    terminal = msg.terminal ?? false;
    failure = msg.failure;
  } else {
    terminal = false;
    failure = msg;
  }

  const errorMessage = failure?.message ?? "(missing error message)";
  const errorCode = failure?.code ?? ErrorCodes.INTERNAL;

  return terminal
    ? new TerminalError(errorMessage, { errorCode })
    : new RestateError(errorMessage, { errorCode });
}
