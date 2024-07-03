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
  TRACE = 1,
  DEBUG = 2,
  INFO = 3,
  WARN = 4,
  ERROR = 5,
}

function logLevelName(level: RestateLogLevel) {
  switch (level) {
    case RestateLogLevel.TRACE:
      return "TRACE";
    case RestateLogLevel.DEBUG:
      return "DEBUG";
    case RestateLogLevel.INFO:
      return "INFO";
    case RestateLogLevel.WARN:
      return "WARN";
    case RestateLogLevel.ERROR:
      return "ERROR";
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
  context?: LoggerContext;
};

export type Logger = (
  params: LogParams,
  message?: any,
  ...optionalParams: any[]
) => void;

const defaultLogger: Logger = (
  params: LogParams,
  message?: any,
  ...optionalParams: any[]
) => {
  if (params.level < RESTATE_LOG_LEVEL) {
    return;
  }
  const p = `${formatLogPrefix(
    params.context
  )}[${new Date().toISOString()}] ${logLevelName(params.level)}: `;
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

let logger: Logger = defaultLogger;

/**
 * Replace the default console-based {@link Logger}
 * @param newLogger
 * @example
 * ```ts
 *     restate.setLogger((params, message, ...o) => {console.log(`${params.level}: `, message, ...o)})
 *  ```
 */
export function setLogger(newLogger: Logger) {
  logger = newLogger;
}

function readRestateLogLevel(): RestateLogLevel {
  const env = globalThis.process?.env?.RESTATE_LOGGING;
  const level = logLevelFromName(env);
  if (level != null) {
    return level;
  }
  return RestateLogLevel.INFO;
}

export const RESTATE_LOG_LEVEL = readRestateLogLevel();

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
  source: LogSource,
  level: RestateLogLevel,
  shouldLog: () => boolean,
  context?: LoggerContext
): PropertyDescriptor {
  return {
    get: (): Logger => {
      if (!shouldLog()) {
        return () => {
          // empty logger
        };
      }
      return logger.bind(null, { source, level, context });
    },
  };
}

export enum LogSource {
  SYSTEM = "SYSTEM",
  JOURNAL = "JOURNAL",
  USER = "USER",
}

export function createRestateConsole(
  source: LogSource,
  context?: LoggerContext,
  shouldLog: () => boolean = () => true
): Console {
  return Object.create(console, {
    trace: loggerForLevel(source, RestateLogLevel.TRACE, shouldLog, context),
    debug: loggerForLevel(source, RestateLogLevel.DEBUG, shouldLog, context),
    info: loggerForLevel(source, RestateLogLevel.INFO, shouldLog, context),
    warn: loggerForLevel(source, RestateLogLevel.WARN, shouldLog, context),
    error: loggerForLevel(source, RestateLogLevel.ERROR, shouldLog, context),
  }) as Console;
}

/**
 * This is a simple console without contextual info.
 *
 * This should be used only in cases where no contextual info is available.
 */
export const rlog = createRestateConsole(LogSource.SYSTEM);
