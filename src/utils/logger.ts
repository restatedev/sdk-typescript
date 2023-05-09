/* eslint-disable @typescript-eslint/no-explicit-any */

// effectively duplicate the console object (new object with same prototype)
// to override some specific methods
const restate_logger = Object.create(console);

restate_logger.log = (message?: any, ...optionalParams: any[]) => {
  console.log("[restate] [%s] LOG: " + message, new Date(), ...optionalParams);
};

restate_logger.info = (message?: any, ...optionalParams: any[]) => {
  console.info(
    "[restate] [%s] INFO: " + message,
    new Date(),
    ...optionalParams
  );
};

restate_logger.warn = (message?: any, ...optionalParams: any[]) => {
  console.warn(
    "[restate] [%s] WARN: " + message,
    new Date(),
    ...optionalParams
  );
};

restate_logger.error = (message?: any, ...optionalParams: any[]) => {
  console.error(
    "[restate] [%s] ERROR: " + message,
    new Date(),
    ...optionalParams
  );
};

restate_logger.debug = (message?: any, ...optionalParams: any[]) => {
  console.debug(
    "[restate] [%s] DEBUG: " + message,
    new Date(),
    ...optionalParams
  );
};

restate_logger.trace = (message?: any, ...optionalParams: any[]) => {
  console.trace(
    "[restate] [%s] TRACE: " + message,
    new Date(),
    ...optionalParams
  );
};

/**
 * The RestateLogger lets us add some extra information to logging statements:
 * [restate] [timestamp] INFO/WARN/ERROR/DEBUG/TRACE <log-message>.
 *
 * We don't override the console here, to make sure that this only applies to Restate
 * log lines, and not to logging from application code.
 */
export const rlog = restate_logger as Console;
