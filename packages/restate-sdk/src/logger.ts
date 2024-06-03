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

function logFunction(level: RestateLogLevel) {
  switch (level) {
    case RestateLogLevel.TRACE:
      return console.trace;
    case RestateLogLevel.DEBUG:
      return console.debug;
    case RestateLogLevel.INFO:
      return console.info;
    case RestateLogLevel.WARN:
      return console.warn;
    case RestateLogLevel.ERROR:
      return console.error;
    default:
      throw new TypeError(`unset or unknown log level ${level}`);
  }
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

const NOOP_DESCRIPTOR = {
  get() {
    return () => {
      // a no-op function
    };
  },
};

function loggerForLevel(
  level: RestateLogLevel,
  shouldLog: () => boolean,
  prefix: string
): PropertyDescriptor {
  if (level < RESTATE_LOG_LEVEL) {
    return NOOP_DESCRIPTOR;
  }

  const name = logLevelName(level);
  const fn = logFunction(level);

  return {
    get: () => {
      if (!shouldLog()) {
        return () => {
          // empty logger
        };
      }
      const p = `${prefix}[${new Date().toISOString()}] ${name}: `;
      return fn.bind(console, p);
    },
  };
}

export function createRestateConsole(
  context?: LoggerContext,
  filter?: () => boolean
): Console {
  const prefix = formatLogPrefix(context);
  const shouldLog: () => boolean = filter ?? (() => true);

  return Object.create(console, {
    trace: loggerForLevel(RestateLogLevel.TRACE, shouldLog, prefix),
    debug: loggerForLevel(RestateLogLevel.DEBUG, shouldLog, prefix),
    info: loggerForLevel(RestateLogLevel.INFO, shouldLog, prefix),
    warn: loggerForLevel(RestateLogLevel.WARN, shouldLog, prefix),
    error: loggerForLevel(RestateLogLevel.ERROR, shouldLog, prefix),
  });
}

/**
 * This is a simple console without contextual info.
 *
 * This should be used only in cases where no contextual info is available.
 */
export const rlog = createRestateConsole();
