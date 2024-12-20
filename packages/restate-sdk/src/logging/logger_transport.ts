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

import type { Request } from "../context.js";

/**
 * Logger level.
 */
export enum RestateLogLevel {
  TRACE = "trace",
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * Source of the log.
 */
export enum LogSource {
  SYSTEM = "SYSTEM",
  JOURNAL = "JOURNAL",
  USER = "USER",
}

/**
 * Log event metadata metadata.
 */
export type LogMetadata = {
  source: LogSource;
  level: RestateLogLevel;
  replaying: boolean;
  context?: LoggerContext;
};

/**
 * @deprecated use {@link LogMetadata}
 */
export type LogParams = LogMetadata;

/**
 * Logger transport, often known in other logging libraries as appender. Filtering of log events should happen within this function as well.
 *
 * This can be overridden in {@link RestateEndpointBase.setLogger} to customize logging. The default Logger transport will log to console.
 */
export type LoggerTransport = (
  params: LogMetadata,
  message?: any,
  ...optionalParams: any[]
) => void;

/**
 * @deprecated use {@link LoggerTransport}
 */
export type Logger = LoggerTransport;

/**
 * Logger context.
 */
export class LoggerContext {
  readonly invocationTarget: string;

  constructor(
    readonly invocationId: string,
    readonly serviceName: string,
    readonly handlerName: string,
    readonly key?: string,
    readonly request?: Request,
    readonly additionalContext?: { [name: string]: string }
  ) {
    this.invocationTarget =
      key === undefined || key.length === 0
        ? `${serviceName}/${handlerName}`
        : `${serviceName}/${key}/${handlerName}`;
  }
}
