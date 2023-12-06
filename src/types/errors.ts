/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ErrorMessage, Failure } from "../generated/proto/protocol";
import { printMessageAsJson } from "../utils/utils";
import { Message } from "./types";
import { JournalEntry } from "../journal";
import { FailureWithTerminal } from "../generated/proto/javascript";

export enum ErrorCodes {
  /**
   *  Not an error; returned on success.
   *  HTTP 200
   */
  OK = 0,
  /**
   * The operation was cancelled, typically by the caller.
   * HTTP 408
   */
  CANCELLED = 1,
  /**
   * Unknown error. For example, this error may be returned when a
   * Status value received from another address space belongs to an error
   * space that is not known in this address space. Also errors raised by APIs
   * that do  not return enough error information may be converted to this
   * error.
   * HTTP 500
   */
  UNKNOWN = 2,
  /**
   * The client specified an invalid argument. Note that
   * this differs from FAILED_PRECONDITION. INVALID_ARGUMENT indicates
   * arguments that are problematic regardless of the state of the system
   * (e.g., a malformed file name).
   * HTTP 400
   */
  INVALID_ARGUMENT = 3,
  /**
   * The deadline expired before the operation could
   * complete. For operations that change the state of the system, this error
   * may be returned even if the operation has completed successfully. For
   * example, a successful response from a server could have been delayed
   * long.
   * HTTP 408
   */
  DEADLINE_EXCEEDED = 4,
  /**
   * Some requested entity (e.g., file or directory) was not
   * found. Note to server developers: if a request is denied for an entire
   * class of users, such as gradual feature rollout or undocumented
   * allowlist, NOT_FOUND may be used. If a request is denied for some users
   * within a class of users, such as user-based access control,
   * PERMISSION_DENIED must be used.
   * HTTP 404
   */
  NOT_FOUND = 5,
  /**
   * The entity that a client attempted to create (e.g., file
   * or directory) already exists.
   * HTTP 409
   */
  ALREADY_EXISTS = 6,
  /**
   * The caller does not have permission to execute the
   * specified operation. PERMISSION_DENIED must not be used for rejections
   * caused by exhausting some resource (use RESOURCE_EXHAUSTED instead for
   * those errors). PERMISSION_DENIED must not be used if the caller can not
   * be identified (use UNAUTHENTICATED instead for those errors). This error
   * code does not imply the request is valid or the requested entity exists
   * or satisfies other pre-conditions.
   * HTTP 403
   */
  PERMISSION_DENIED = 7,
  /**
   * Some resource has been exhausted, perhaps a per-user
   * quota, or perhaps the entire file system is out of space.
   * HTTP 413
   */
  RESOURCE_EXHAUSTED = 8,
  /**
   * The operation was rejected because the system is
   * not in a state required for the operation's execution. For example, the
   * directory to be deleted is non-empty, an rmdir operation is applied to a
   * non-directory, etc. Service implementors can use the following guidelines
   * to decide between FAILED_PRECONDITION, ABORTED, and UNAVAILABLE: (a) Use
   * UNAVAILABLE if the client can retry just the failing call. (b) Use
   * ABORTED if the client should retry at a higher level (e.g., when a
   * client-specified test-and-set fails, indicating the client should restart
   * a read-modify-write sequence). (c) Use FAILED_PRECONDITION if the client
   * should not retry until the system state has been explicitly fixed. E.g.,
   * if an "rmdir" fails because the directory is non-empty,
   * FAILED_PRECONDITION should be returned since the client should not retry
   * unless the files are deleted from the directory.
   * HTTP 412
   */
  FAILED_PRECONDITION = 9,
  /**
   * The operation was aborted, typically due to a concurrency issue
   * such as a sequencer check failure or transaction abort. See the
   * guidelines above for deciding between FAILED_PRECONDITION, ABORTED, and
   * UNAVAILABLE.
   * HTTP 409
   */
  ABORTED = 10,
  /**
   * The operation was attempted past the valid range. E.g.,
   * seeking or reading past end-of-file. Unlike INVALID_ARGUMENT, this error
   * indicates a problem that may be fixed if the system state changes. For
   * example, a 32-bit file system will generate INVALID_ARGUMENT if asked to
   * read at an offset that is not in the range [0,2^32-1], but it will
   * generate OUT_OF_RANGE if asked to read from an offset past the current
   * file size. There is a fair bit of overlap between FAILED_PRECONDITION and
   * OUT_OF_RANGE. We recommend using OUT_OF_RANGE (the more specific error)
   * when it applies so that callers who are iterating through a space can
   * easily look for an OUT_OF_RANGE error to detect when they are done.
   * HTTP 400
   */
  OUT_OF_RANGE = 11,
  /**
   * The operation is not implemented or is not
   * supported/enabled in this service.
   * HTTP 501
   */
  UNIMPLEMENTED = 12,
  /**
   * Internal errors. This means that some invariants expected by
   * the underlying system have been broken. This error code is reserved for
   * serious errors.
   * HTTP 500
   */
  INTERNAL = 13,
  /**
   * The service is currently unavailable. This is most likely a
   * transient condition, which can be corrected by retrying with a backoff.
   * Note that it is not always safe to retry non-idempotent operations.
   * HTTP 503
   */
  UNAVAILABLE = 14,
  /**
   * Unrecoverable data loss or corruption.
   * HTTP 500
   */
  DATA_LOSS = 15,
  /**
   * The request does not have valid authentication
   * credentials for the operation.
   * HTTP 401
   */
  UNAUTHENTICATED = 16,
}
export enum RestateErrorCodes {
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
    return new RetryableError(msg, { errorCode: RestateErrorCodes.JOURNAL_MISMATCH });
  }

  public static protocolViolation(message: string) {
    return new RetryableError(message, {
      errorCode: RestateErrorCodes.PROTOCOL_VIOLATION,
    });
  }

  public static apiViolation(message: string) {
    return new RetryableError(`API violation: ${message}`, {
      errorCode: ErrorCodes.INTERNAL,
    });
  }
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

export function failureToError(
  failure: Failure,
  terminalError: boolean
): Error {
  const errorMessage = failure.message ?? "(missing error message)";
  const errorCode = failure.code ?? ErrorCodes.INTERNAL;

  return terminalError
    ? new TerminalError(errorMessage, { errorCode })
    : new RestateError(errorMessage, { errorCode });
}

export function errorToErrorMessage(err: Error): ErrorMessage {
  const code = err instanceof RestateError ? err.code : ErrorCodes.INTERNAL;

  return ErrorMessage.create({
    code: code,
    message: err.message,
  });
}
