/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */

import { printMessageAsJson } from "./utils";

/**
 * Simple extension of the Console interface, to add debug logging per message.
 * Because per-message logging can be very expensive, it is not active by default.
 *
 * This method also supports lazy construction of stringified message object,
 * because constructing that stringified representation is even more expensive.
 */
export interface RestateConsole extends Console {
  /**
   * Called to log per-invocation debug messages.
   *
   * Under load, this can generate a large amount of log output. Due to that, this
   * function by default logs only if the 'NODE_ENV' environment is not set to
   * 'production', or if explicitly configured via the restate 'RESTATE_DEBUG_LOGGING'
   * environment variable. See {@link DEBUG_LOG_LEVEL} for details.
   */
  debugInvokeMessage(invocationInfo: string, logMessage: string): void;

  /**
   * Called to log per-jounral action debug messages.
   *
   * Under load, this can generate an insane amount of log output. Due to that, this
   * function doesn't actually output log entries unless configured via the 'RESTATE_DEBUG_LOGGING'
   * environment variable. See {@link DEBUG_LOG_LEVEL} for details.
   */
  debugJournalMessage(
    invocationInfo: string,
    logMessage: string,
    journalMessageObject: any
  ): void;
}

/**
 * The environment variable which is read to determine the debug log settings.
 */
export const DEBUG_LOGGING_ENV = "RESTATE_DEBUG_LOGGING";

/**
 * The values for the {@link DEBUG_LOGGING_ENV} variable.
 */
export enum DEBUG_LOG_LEVEL {
  /** No debug logging at all. Good for performance and avoid per-invocation log volume */
  OFF = "OFF",

  /** Logs debug information for every Restate function invocation. */
  INVOKE = "INVOKE",

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... */
  JOURNAL = "JOURNAL",

  /** Logs debug information for every Restate effect (=journal event) inside an invocation,
   *  like RPC, state access, sideEffect, ... Additionally, this adds a JSON representation
   *  of the journal message to the log. */
  JOURNAL_VERBOSE = "JOURNAL_VERBOSE",
}

const log_setting = process.env[DEBUG_LOGGING_ENV]?.toUpperCase();
const verbose_journal_event_logging: boolean =
  log_setting == DEBUG_LOG_LEVEL.JOURNAL_VERBOSE;
const journal_event_logging: boolean =
  verbose_journal_event_logging || log_setting == DEBUG_LOG_LEVEL.JOURNAL;
const invoke_event_logging: boolean =
  journal_event_logging ||
  log_setting == DEBUG_LOG_LEVEL.INVOKE ||
  (log_setting != DEBUG_LOG_LEVEL.OFF &&
    process.env["NODE_ENV"] !== "production");

// ----------------------------------------------------------------------------
//  build restate logger
// ----------------------------------------------------------------------------

// effectively duplicate the console object (new object with same prototype)
// to override some specific methods
const restate_logger = Object.create(console);

restate_logger.log = (message?: any, ...optionalParams: any[]) => {
  console.log(
    `[restate] [${new Date().toISOString()}] LOG: ${message}`,
    ...optionalParams
  );
};

restate_logger.info = (message?: any, ...optionalParams: any[]) => {
  console.info(
    `[restate] [${new Date().toISOString()}] INFO: ${message}`,
    ...optionalParams
  );
};

restate_logger.warn = (message?: any, ...optionalParams: any[]) => {
  console.warn(
    `[restate] [${new Date().toISOString()}] WARN: ${message}`,
    ...optionalParams
  );
};

restate_logger.error = (message?: any, ...optionalParams: any[]) => {
  console.error(
    `[restate] [${new Date().toISOString()}] ERROR: ${message}`,
    ...optionalParams
  );
};

restate_logger.debug = (message?: any, ...optionalParams: any[]) => {
  console.debug(
    `[restate] [${new Date().toISOString()}] DEBUG: ${message}`,
    ...optionalParams
  );
};

restate_logger.trace = (message?: any, ...optionalParams: any[]) => {
  console.trace(
    `[restate] [${new Date().toISOString()}] TRACE: ${message}`,
    ...optionalParams
  );
};

restate_logger.debugInvokeMessage = function (
  invocationInfo: string,
  logMessage: string
): void {
  if (!invoke_event_logging) {
    return;
  }
  const msg = `[restate] [${new Date().toISOString()}] DEBUG: ${invocationInfo} : ${logMessage}`;
  console.debug(msg);
};

restate_logger.debugJournalMessage = function (
  invocationInfo: string,
  logMessage: string,
  journalMessageObject: any
): void {
  if (!journal_event_logging) {
    return;
  }
  const journalEvent = verbose_journal_event_logging
    ? " message: " + printMessageAsJson(journalMessageObject)
    : "";
  console.debug(
    `[restate] [${new Date().toISOString()}] DEBUG: ${invocationInfo} : ${logMessage}${journalEvent}`
  );
};

/**
 * The RestateLogger lets us add some extra information to logging statements:
 * [restate] [timestamp] INFO/WARN/ERROR/DEBUG/TRACE <log-message>.
 *
 * It also adds the methods {@link RestateConsole.debugInvokeMessage} and *
 * {@link RestateConsole.debugJournalMessage} for optional intensive (per
 * invocation / per journal message) logging.
 *
 * We don't override the console here, to make sure that this only applies to Restate
 * log lines, and not to logging from application code.
 */
export const rlog = restate_logger as RestateConsole;
