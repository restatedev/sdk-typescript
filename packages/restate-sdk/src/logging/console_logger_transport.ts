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
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import type {
  LogMetadata,
  LoggerTransport,
  LoggerContext,
} from "./logger_transport.js";
import { RestateLogLevel } from "./logger_transport.js";

export const defaultLoggerTransport: LoggerTransport = (
  params: LogMetadata,
  message?: any,
  ...optionalParams: any[]
) => {
  if (params.replaying) {
    return;
  }
  if (logLevel(params.level) < logLevel(DEFAULT_CONSOLE_LOGGER_LOG_LEVEL)) {
    return;
  }
  const p = `${formatLogPrefix(params.context)} ${params.level.toUpperCase()}:`;
  switch (params.level) {
    case RestateLogLevel.TRACE:
      return console.trace(p, message, ...optionalParams);
    case RestateLogLevel.DEBUG:
      return console.debug(p, message, ...optionalParams);
    case RestateLogLevel.INFO:
      return console.info(p, message, ...optionalParams);
    case RestateLogLevel.WARN:
      return console.warn(p, message, ...optionalParams);
    case RestateLogLevel.ERROR:
      return console.error(p, message, ...optionalParams);
    default:
      throw new TypeError(`unset or unknown log level ${params.level}`);
  }
};

// this is the log level as provided by the environment variable RESTATE_LOG_LEVEL,
// but it only affects the default logger - custom loggers get all log events and
// should use their own filtering mechanism
export const DEFAULT_CONSOLE_LOGGER_LOG_LEVEL = readRestateLogLevel();

function readRestateLogLevel(): RestateLogLevel {
  const env = globalThis.process?.env?.RESTATE_LOGGING;
  const level = logLevelFromName(env);
  if (level !== null) {
    return level;
  }
  return RestateLogLevel.INFO;
}

function logLevelFromName(name?: string): RestateLogLevel | null {
  if (!name) {
    return null;
  }
  const n = name.toUpperCase();
  switch (n) {
    case "TRACE":
      return RestateLogLevel.TRACE;
    case "DEBUG":
      return RestateLogLevel.DEBUG;
    case "INFO":
      return RestateLogLevel.INFO;
    case "WARN":
      return RestateLogLevel.WARN;
    case "ERROR":
      return RestateLogLevel.ERROR;
    default:
      throw new TypeError(`unknown name ${name}`);
  }
}

function logLevel(level: RestateLogLevel): number {
  switch (level) {
    case RestateLogLevel.TRACE:
      return 1;
    case RestateLogLevel.DEBUG:
      return 2;
    case RestateLogLevel.INFO:
      return 3;
    case RestateLogLevel.WARN:
      return 4;
    case RestateLogLevel.ERROR:
      return 5;
  }
}

function formatLogPrefix(context?: LoggerContext): string {
  let prefix = `[restate][${new Date().toISOString()}]`;
  if (context === undefined) {
    return prefix;
  }
  prefix = `${prefix}[${context.invocationTarget}][${context.invocationId}]`;
  if (context.additionalContext !== undefined) {
    for (const [k, v] of Object.entries(context.additionalContext)) {
      prefix = prefix + `[${k}: ${v}]`;
    }
  }
  return prefix;
}
