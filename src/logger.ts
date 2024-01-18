/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
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

export class LoggerContext {
  readonly fqMethodName: string;

  constructor(
    readonly invocationId: string,
    packageName: string,
    serviceName: string,
    methodName: string,
    readonly awsRequestId?: string
  ) {
    this.fqMethodName = packageName
      ? `${packageName}.${serviceName}/${methodName}`
      : `${serviceName}/${methodName}`;
  }
}

function formatLogPrefix(context?: LoggerContext): string {
  if (context === undefined) {
    return "[restate] ";
  }
  let prefix = `[restate] [${context.fqMethodName}][${context.invocationId}]`;
  if (context.awsRequestId !== undefined) {
    prefix = prefix + `[AWS RequestId: ${context.awsRequestId}]`;
  }
  return prefix;
}

export function createRestateConsole(
  context?: LoggerContext,
  filter?: () => boolean
): Console {
  const prefix = formatLogPrefix(context);
  const restate_logger = Object.create(console);

  const shouldLog: () => boolean = filter || (() => true);

  restate_logger.log = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.log(
      prefix + `[${new Date().toISOString()}] LOG: ` + message,
      ...optionalParams
    );
  };

  restate_logger.info = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.info(
      prefix + `[${new Date().toISOString()}] INFO: ` + message,
      ...optionalParams
    );
  };

  restate_logger.warn = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.warn(
      prefix + `[${new Date().toISOString()}] WARN: ` + message,
      ...optionalParams
    );
  };

  restate_logger.error = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.error(
      prefix + `[${new Date().toISOString()}] ERROR: ` + message,
      ...optionalParams
    );
  };

  restate_logger.debug = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.debug(
      prefix + `[${new Date().toISOString()}] DEBUG: ` + message,
      ...optionalParams
    );
  };

  restate_logger.trace = (message?: any, ...optionalParams: any[]) => {
    if (!shouldLog()) {
      return;
    }
    console.trace(
      prefix + `[${new Date().toISOString()}] TRACE: ` + message,
      ...optionalParams
    );
  };

  return restate_logger;
}

/**
 * This is a simple console without contextual info.
 *
 * This should be used only in cases where no contextual info is available.
 */
export const rlog = createRestateConsole();
