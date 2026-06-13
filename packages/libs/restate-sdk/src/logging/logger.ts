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

import type { LoggerTransport, LogSource } from "./logger_transport.js";
import { LoggerContext, RestateLogLevel } from "./logger_transport.js";
import type { RestateConsole } from "../context.js";

/**
 * Logging facade used internally by the Restate SDK.
 */
export interface Logger extends RestateConsole {
  /**
   * Emits a log event at the provided Restate log level
   */
  logForLevel(
    level: RestateLogLevel,
    message?: any,
    ...optionalParams: any[]
  ): void;
}

export function createLogger(
  loggerTransport: LoggerTransport,
  source: LogSource,
  context?: LoggerContext,
  isReplaying: () => boolean = () => false
): Logger {
  /**
   * Builds the immutable context for a child logger by merging parent and child
   * fields without mutating the parent logger context.
   */
  function childLoggerContext(
    context: LoggerContext | undefined,
    additionalContext: Record<string, string>
  ): LoggerContext | undefined {
    if (context === undefined) {
      return undefined;
    }
    return new LoggerContext(
      context.invocationId,
      context.serviceName,
      context.handlerName,
      context.key,
      context.request,
      {
        ...context.additionalContext,
        ...additionalContext,
      }
    );
  }

  function loggerForLevel(
    loggerTransport: LoggerTransport,
    source: LogSource,
    level: RestateLogLevel,
    isReplaying: () => boolean,
    context?: LoggerContext
  ): PropertyDescriptor {
    return {
      get: () => {
        return loggerTransport.bind(null, {
          source,
          level,
          replaying: isReplaying(),
          context,
        });
      },
    };
  }

  const info = loggerForLevel(
    loggerTransport,
    source,
    RestateLogLevel.INFO,
    isReplaying,
    context
  );
  return Object.create(console, {
    trace: loggerForLevel(
      loggerTransport,
      source,
      RestateLogLevel.TRACE,
      isReplaying,
      context
    ),
    debug: loggerForLevel(
      loggerTransport,
      source,
      RestateLogLevel.DEBUG,
      isReplaying,
      context
    ),
    info,
    log: info,
    warn: loggerForLevel(
      loggerTransport,
      source,
      RestateLogLevel.WARN,
      isReplaying,
      context
    ),
    error: loggerForLevel(
      loggerTransport,
      source,
      RestateLogLevel.ERROR,
      isReplaying,
      context
    ),
    child: {
      get() {
        return (additionalContext: Record<string, string>): Logger => {
          return createLogger(
            loggerTransport,
            source,
            childLoggerContext(context, additionalContext),
            isReplaying
          );
        };
      },
    },
    logForLevel: {
      get() {
        return (
          level: RestateLogLevel,
          message?: any,
          ...optionalParams: any[]
        ): void => {
          if (optionalParams?.length === 0 || optionalParams === undefined) {
            loggerTransport.bind(null)(
              {
                source,
                level,
                replaying: isReplaying(),
                context,
              },
              message
            );
          } else {
            loggerTransport.bind(null)(
              {
                source,
                level,
                replaying: isReplaying(),
                context,
              },
              message,
              optionalParams
            );
          }
        };
      },
    },
  }) as Logger;
}
