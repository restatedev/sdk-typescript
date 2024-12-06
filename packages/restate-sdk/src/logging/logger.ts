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

import type {
  LoggerContext,
  LoggerTransport,
  LogSource,
} from "./logger_transport.js";
import { RestateLogLevel } from "./logger_transport.js";

/**
 * Logging facade used internally by the Restate SDK.
 */
export interface Logger extends Console {
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
    logForLevel: {
      get() {
        return (
          level: RestateLogLevel,
          message?: any,
          ...optionalParams: any[]
        ): void => {
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
        };
      },
    },
  }) as Logger;
}
