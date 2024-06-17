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

import { ErrorMessage, Failure } from "../generated/proto/protocol_pb";
import { formatMessageAsJson } from "../utils/utils";
import * as p from "./protocol";

export const INTERNAL_ERROR_CODE = 500;
export const TIMEOUT_ERROR_CODE = 408;
export const UNKNOWN_ERROR_CODE = 500;

export enum RestateErrorCodes {
  JOURNAL_MISMATCH = 570,
  PROTOCOL_VIOLATION = 571,
}

export type JournalErrorContext = {
  relatedEntryName?: string;
  relatedEntryIndex?: number;
  relatedEntryType?: bigint;
};

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
    this.code = options?.errorCode ?? INTERNAL_ERROR_CODE;
  }

  public toFailure(): Failure {
    return new Failure({
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

export class TimeoutError extends TerminalError {
  constructor() {
    super("Timeout occurred", { errorCode: TIMEOUT_ERROR_CODE });
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
    actualEntry: {
      messageType: bigint;
      message: p.ProtocolMessage | Uint8Array;
    },
    expectedEntry: {
      messageType: bigint;
      message: p.ProtocolMessage | Uint8Array;
    }
  ) {
    const msg = `Journal mismatch: Replayed journal entries did not correspond to the user code. The user code has to be deterministic!
        The journal entry at position ${journalIndex} was:
        - In the user code: type: ${
          expectedEntry.messageType
        }, message:${formatMessageAsJson(expectedEntry.message)}
        - In the replayed messages: type: ${
          actualEntry.messageType
        }, message: ${formatMessageAsJson(actualEntry.message)}`;
    return new RetryableError(msg, {
      errorCode: RestateErrorCodes.JOURNAL_MISMATCH,
    });
  }

  public static protocolViolation(message: string) {
    return new RetryableError(message, {
      errorCode: RestateErrorCodes.PROTOCOL_VIOLATION,
    });
  }

  public static apiViolation(message: string) {
    return new RetryableError(`API violation: ${message}`, {
      errorCode: INTERNAL_ERROR_CODE,
    });
  }
}

export function errorToFailure(err: Error): Failure {
  return err instanceof RestateError
    ? err.toFailure()
    : new Failure({
        code: INTERNAL_ERROR_CODE,
        message: err.message,
      });
}

export function failureToTerminalError(failure: Failure): TerminalError {
  return failureToError(failure, true) as TerminalError;
}

export function failureToError(
  failure: Failure,
  terminalError: boolean
): Error {
  const errorMessage = failure.message ?? "(missing error message)";
  const errorCode = failure.code ?? INTERNAL_ERROR_CODE;

  return terminalError
    ? new TerminalError(errorMessage, { errorCode })
    : new RestateError(errorMessage, { errorCode });
}

export function errorToErrorMessage(
  err: Error,
  additionalContext?: JournalErrorContext
): ErrorMessage {
  const code = err instanceof RestateError ? err.code : INTERNAL_ERROR_CODE;

  const ty = additionalContext?.relatedEntryType;

  return new ErrorMessage({
    code: code,
    message: err.message,
    relatedEntryName: additionalContext?.relatedEntryName,
    relatedEntryIndex: additionalContext?.relatedEntryIndex,
    relatedEntryType: ty !== undefined ? Number(ty) : undefined,
  });
}
