import { Logger } from "../../logging/logger.js";
import { LogSource, RestateLogLevel } from "../../logging/logger_transport.js";
import * as vm from "./vm/sdk_shared_core_wasm_bindings.js";
import { defaultLoggerTransport } from "../../logging/console_logger_transport.js";

/**
 * This file contains the shared state used to install a logger that the shared-core uses for logging.
 */

const invocationLoggers: Map<number, Logger> = new Map<number, Logger>();
const logsTextDecoder = new TextDecoder("utf-8", { fatal: false });

/**
 * The shared core propagates logs to the SDK invoking this method.
 * When possible, it provides an invocationId, which is used to access the registered invocationLoggers, that should contain the logger per invocation id.
 */
export function vm_log(
  level: vm.LogLevel,
  strBytes: Uint8Array,
  loggerId?: number
) {
  try {
    const logger = (loggerId && invocationLoggers.get(loggerId)) || undefined;
    const str = logsTextDecoder.decode(strBytes);
    if (logger !== undefined) {
      logger.logForLevel(wasmLogLevelToRestateLogLevel(level), str);
    } else {
      defaultLoggerTransport(
        {
          level: wasmLogLevelToRestateLogLevel(level),
          replaying: false,
          source: LogSource.JOURNAL,
        },
        str
      );
    }
  } catch (e) {
    // This function CAN'T EVER propagate an error,
    // because otherwise it will cause an awesome error in the shared core due to concurrent usage of it.
    defaultLoggerTransport(
      {
        level: RestateLogLevel.ERROR,
        replaying: false,
        source: LogSource.SYSTEM,
      },
      "Unexpected error thrown while trying to log: " + e?.toString()
    );
  }
}

export function registerLogger(loggerId: number, logger: Logger) {
  invocationLoggers.set(loggerId, logger);
}

export function destroyLogger(loggerId: number) {
  invocationLoggers.delete(loggerId);
}

function wasmLogLevelToRestateLogLevel(level: vm.LogLevel): RestateLogLevel {
  switch (level) {
    case vm.LogLevel.TRACE:
      return RestateLogLevel.TRACE;
    case vm.LogLevel.DEBUG:
      return RestateLogLevel.DEBUG;
    case vm.LogLevel.INFO:
      return RestateLogLevel.INFO;
    case vm.LogLevel.WARN:
      return RestateLogLevel.WARN;
    case vm.LogLevel.ERROR:
      return RestateLogLevel.ERROR;
  }
}
