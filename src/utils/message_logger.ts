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

import { formatMessageType } from "../types/protocol";
import { formatMessageAsJson } from "./utils";
import { createRestateConsole, LoggerContext } from "../logger";

/**
 * The environment variable which is read to determine the debug log settings.
 */
export const DEBUG_LOGGING_ENV = "RESTATE_DEBUG_LOGGING";

/**
 * The values for the {@link DEBUG_LOGGING_ENV} variable.
 */
export enum RestateDebugLogLevel {
  /** No debug logging at all. Good for performance and avoid per-invocation log volume */
  OFF,

  /** Logs debug information for every Restate function invocation. */
  INVOKE,

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... */
  JOURNAL,

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... Additionally, this adds a JSON representation
   *  of the journal message to the log. */
  JOURNAL_VERBOSE,
}

const DEFAULT_DEBUG_LOG_LEVEL =
  process.env["NODE_ENV"]?.toUpperCase() === "PRODUCTION"
    ? RestateDebugLogLevel.OFF
    : RestateDebugLogLevel.INVOKE;

function readLogLevel(): RestateDebugLogLevel {
  const env = process.env[DEBUG_LOGGING_ENV]?.toUpperCase();
  if (env == undefined) {
    return DEFAULT_DEBUG_LOG_LEVEL;
  }
  const idx = Object.keys(RestateDebugLogLevel)
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
  debugInvokeMessage: (msg: string) => void;

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
    debugInvokeMessage: {
      value: (msg: string) => {
        if (log_level >= RestateDebugLogLevel.INVOKE) {
          console.debug(msg);
        }
      },
    },
    debugJournalMessage: {
      value: (logMessage: string, messageType?: bigint, message?: any) => {
        if (log_level >= RestateDebugLogLevel.JOURNAL) {
          const type =
            messageType !== undefined
              ? " ; " + formatMessageType(messageType)
              : "";
          const journalEvent =
            log_level >= RestateDebugLogLevel.JOURNAL_VERBOSE &&
            message !== undefined
              ? " : " + formatMessageAsJson(message)
              : "";
          console.debug(`${logMessage}${type}${journalEvent}`);
        }
      },
    },
  });

  return console as StateMachineConsole;
}
