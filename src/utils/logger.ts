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
  debugJournalMessage(
    invocationInfo: string,
    logMessage: string,
    journalMessageObject: any
  ): void;
}

/**
 * The environment variable which is read to determine the debug log settings.
 */
export const DEBUG_ENV = "RESTATE_DEBUG_LOG";

/**
 * The debug log setting for {@link DEBUG_ENV} to print log text.
 */
export const DEBUG_SETTING_LOG = "LOG";

/**
 * The debug log setting for {@link DEBUG_ENV} to include the stringified message
 * objects (where applicable) in the log messages.
 */
export const DEBUG_SETTING_MESSAGES = "MESSAGES";

// ----------------------------------------------------------------------------
//  build restate logger
// ----------------------------------------------------------------------------

const debugMessageObjects = process.env[DEBUG_ENV] === DEBUG_SETTING_MESSAGES;
const debugLogging: boolean =
  debugMessageObjects || process.env[DEBUG_ENV] === DEBUG_SETTING_LOG;

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

restate_logger.debugJournalMessage = function (
  invocationInfo: string,
  logMessage: string,
  journalMessageObject: any
): void {
  if (!debugLogging) {
    return;
  }
  const journalEvent = debugMessageObjects
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
 * It also adds the method {@link RestateConsole.debugJournalMessage} for optional
 * intensive (per invocation / per journal message) logging.
 *
 * We don't override the console here, to make sure that this only applies to Restate
 * log lines, and not to logging from application code.
 */
export const rlog = restate_logger as RestateConsole;
