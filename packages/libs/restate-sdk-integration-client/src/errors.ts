/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import {
  ErrorKind,
  type Error as ProtoError,
} from "./generated/dev/restate/ingress/ingestion/v1/ingestion_svc_pb.js";

/**
 * Classification of an ingestion stream failure.
 *
 * - `unknown`: transport failure, unexpected end of the stream, or an unclassified error.
 * - `shutting_down`: the Restate node is shutting down.
 * - `go_away`: protocol violation.
 * - `not_found`: unknown target service or handler.
 * - `bad_request`: invalid record, e.g. a missing or unexpected key.
 * - `unavailable`: Restate cannot process the request yet; retry later.
 *
 * @experimental
 */
export type IntegrationClientErrorKind =
  | "unknown"
  | "shutting_down"
  | "go_away"
  | "not_found"
  | "bad_request"
  | "unavailable";

/**
 * The error producer operations reject with when the ingestion stream fails.
 *
 * Restate tears the stream down after any error. A record-scoped error carries the
 * {@link IntegrationClientError.offset} of the rejected record; to recover, an exactly-once
 * producer resumes from the last committed offset and skips (or fixes) that record.
 *
 * @experimental
 */
export class IntegrationClientError extends Error {
  /** Classification of the failure. */
  readonly kind: IntegrationClientErrorKind;

  /**
   * Offset of the record the error is about, or `undefined` when the error concerns the
   * stream as a whole.
   */
  readonly offset?: number;

  constructor(
    kind: IntegrationClientErrorKind,
    message: string,
    options?: { offset?: number; cause?: unknown }
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = "IntegrationClientError";
    this.kind = kind;
    if (options?.offset !== undefined) {
      this.offset = options.offset;
    }
  }
}

export function errorFromProto(error: ProtoError): IntegrationClientError {
  const kind = kindFromProto(error.kind);
  const message = error.message || kind;
  if (error.invocationOffset === undefined) {
    return new IntegrationClientError(kind, message);
  }
  return new IntegrationClientError(
    kind,
    `[offset=${error.invocationOffset}] ${message}`,
    { offset: toSafeNumber(error.invocationOffset) }
  );
}

/** Converts a uint64 from the wire, saturating at `Number.MAX_SAFE_INTEGER`. */
export function toSafeNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

function kindFromProto(kind: ErrorKind): IntegrationClientErrorKind {
  switch (kind) {
    case ErrorKind.SHUTTING_DOWN:
      return "shutting_down";
    case ErrorKind.GO_AWAY:
      return "go_away";
    case ErrorKind.NOT_FOUND:
      return "not_found";
    case ErrorKind.BAD_REQUEST:
      return "bad_request";
    case ErrorKind.UNAVAILABLE:
      return "unavailable";
    default:
      return "unknown";
  }
}
