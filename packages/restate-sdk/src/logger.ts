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

export enum RestateLogLevel {
  TRACE = "trace",
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export function logLevel(level: RestateLogLevel): number {
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

export type LogParams = {
  source: LogSource;
  level: RestateLogLevel;
  replaying: boolean;
  context?: LoggerContext;
};

export type Logger = (
  params: LogParams,
  message?: any,
  ...optionalParams: any[]
) => void;

// this is the log level as provided by the environment variable RESTATE_LOG_LEVEL,
// but it only affects the default logger - custom loggers get all log events and
// should use their own filtering mechanism
export const DEFAULT_LOGGER_LOG_LEVEL = readRestateLogLevel();

export const defaultLogger: Logger = (
  params: LogParams,
  message?: any,
  ...optionalParams: any[]
) => {
  if (logLevel(params.level) < logLevel(DEFAULT_LOGGER_LOG_LEVEL)) {
    return;
  }
  const p = `${formatLogPrefix(
    params.context
  )}[${new Date().toISOString()}] ${params.level.toUpperCase()}: `;
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

function readRestateLogLevel(): RestateLogLevel {
  const env = globalThis.process?.env?.RESTATE_LOGGING;
  const level = logLevelFromName(env);
  if (level != null) {
    return level;
  }
  return RestateLogLevel.INFO;
}

export class LoggerContext {
  readonly fqMethodName: string;

  constructor(
    readonly invocationId: string,
    packageName: string,
    serviceName: string,
    handlerName: string,
    readonly additionalContext?: { [name: string]: string }
  ) {
    this.fqMethodName = packageName
      ? `${packageName}.${serviceName}/${handlerName}`
      : `${serviceName}/${handlerName}`;
  }
}

function formatLogPrefix(context?: LoggerContext): string {
  if (context === undefined) {
    return "[restate] ";
  }
  let prefix = `[restate] [${context.fqMethodName}][${context.invocationId}]`;
  if (context.additionalContext !== undefined) {
    for (const [k, v] of Object.entries(context.additionalContext)) {
      prefix = prefix + `[${k}: ${v}]`;
    }
  }
  return prefix;
}

function loggerForLevel(
  logger: Logger,
  source: LogSource,
  level: RestateLogLevel,
  isReplaying: () => boolean,
  context?: LoggerContext
): PropertyDescriptor {
  return {
    get: (): Logger => {
      return logger.bind(null, {
        source,
        level,
        replaying: isReplaying(),
        context,
      });
    },
  };
}

export enum LogSource {
  SYSTEM = "SYSTEM",
  JOURNAL = "JOURNAL",
  USER = "USER",
}

export function createRestateConsole(
  logger: Logger,
  source: LogSource,
  context?: LoggerContext,
  isReplaying: () => boolean = () => false
): Console {
  return Object.create(console, {
    trace: loggerForLevel(
      logger,
      source,
      RestateLogLevel.TRACE,
      isReplaying,
      context
    ),
    debug: loggerForLevel(
      logger,
      source,
      RestateLogLevel.DEBUG,
      isReplaying,
      context
    ),
    info: loggerForLevel(
      logger,
      source,
      RestateLogLevel.INFO,
      isReplaying,
      context
    ),
    warn: loggerForLevel(
      logger,
      source,
      RestateLogLevel.WARN,
      isReplaying,
      context
    ),
    error: loggerForLevel(
      logger,
      source,
      RestateLogLevel.ERROR,
      isReplaying,
      context
    ),
  }) as Console;
}
