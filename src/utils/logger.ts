/**
 * To add some extra information to logging statements:
 * [restate] [timestamp] INFO/WARN/ERROR/DEBUG/TRACE <log-message>
 */

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  trace: console.trace,
};

const prefixedLog = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalFn: (...args: any[]) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  prefix: string
) => {
  originalFn(prefix, ...args);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.log = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] LOG`;
  prefixedLog(originalConsole.log, args, logPrefix);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.info = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] INFO:`;
  prefixedLog(originalConsole.info, args, logPrefix);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.warn = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] WARN:`;
  prefixedLog(originalConsole.warn, args, logPrefix);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.error = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] ERROR:`;
  prefixedLog(originalConsole.error, args, logPrefix);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.debug = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] DEBUG:`;
  prefixedLog(originalConsole.debug, args, logPrefix);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.trace = (...args: any[]) => {
  const logPrefix = `[restate] [${new Date().toLocaleString()}] ERROR:`;
  prefixedLog(originalConsole.trace, args, logPrefix);
};

global.console = console;
