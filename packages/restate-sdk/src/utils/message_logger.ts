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

import { formatMessageType } from "../types/protocol.js";
import { formatMessageAsJson } from "./utils.js";
import type { LoggerContext } from "../logger.js";
import {
  createRestateConsole,
  RESTATE_LOG_LEVEL,
  RestateLogLevel,
} from "../logger.js";

/**
 * The environment variable which is read to determine the debug log settings.
 */
const RESTATE_JOURNAL_LOGGING = "RESTATE_JOURNAL_LOGGING";

/**
 * The values for the {@link RESTATE_JOURNAL_LOGGING} variable.
 */
enum JournalLoggingLogLevel {
  /** No debug logging at all. Good for performance and avoid per-invocation log volume */
  OFF,

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... */
  DEBUG,

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... Additionally, this adds a JSON representation
   *  of the journal message to the log. */
  TRACE,
}

const DEFAULT_DEBUG_LOG_LEVEL =
  globalThis?.process?.env["NODE_ENV"]?.toUpperCase() === "PRODUCTION" ||
  RESTATE_LOG_LEVEL > RestateLogLevel.DEBUG
    ? JournalLoggingLogLevel.OFF
    : JournalLoggingLogLevel.DEBUG;

function readLogLevel(): JournalLoggingLogLevel {
  const env = globalThis?.process?.env[RESTATE_JOURNAL_LOGGING]?.toUpperCase();
  if (env == undefined) {
    return DEFAULT_DEBUG_LOG_LEVEL;
  }
  const idx = Object.keys(JournalLoggingLogLevel)
    .filter((t) =>
      // Object.keys contains the numbers as well
      // https://stackoverflow.com/questions/48768774/how-to-get-all-the-values-of-an-enum-with-typescript
      isNaN(Number(t))
    )
    .findIndex((level) => level == env);
  if (idx < 0) {
    return DEFAULT_DEBUG_LOG_LEVEL;
  }

  return idx;
}

const log_level = readLogLevel();

export type StateMachineConsole = Console & {
  debugJournalMessage: (
    logMessage: string,
    messageType?: bigint,
    message?: any
  ) => void;
};

export function createStateMachineConsole(
  context: LoggerContext
): StateMachineConsole {
  const console = createRestateConsole(context);

  Object.defineProperties(console, {
    debugJournalMessage: {
      value: (logMessage: string, messageType?: bigint, message?: any) => {
        if (log_level >= JournalLoggingLogLevel.DEBUG) {
          const type =
            messageType !== undefined
              ? " ; " + formatMessageType(messageType)
              : "";
          const journalEvent =
            log_level >= JournalLoggingLogLevel.TRACE && message !== undefined
              ? " : " + formatMessageAsJson(message)
              : "";
          console.debug(`${logMessage}${type}${journalEvent}`);
        }
      },
    },
  });

  return console as StateMachineConsole;
}
