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

import {
  ensureError,
  logError,
  RestateError,
  RetryableError,
  TerminalError,
} from "../../types/errors.js";
import type {
  ProtocolMode,
  Endpoint as EndpointManifest,
} from "../discovery.js";
import type { Component, ComponentHandler } from "../components.js";
import { parseUrlComponents } from "../components.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { type ReadableStream, TransformStream } from "node:stream/web";
import { OnceStream } from "../../utils/streams.js";
import { ContextImpl } from "../../context_impl.js";
import type { Request } from "../../context.js";
import * as vm from "./vm/sdk_shared_core_wasm_bindings.js";
import { CompletablePromise } from "../../utils/completable_promise.js";
import { HandlerKind } from "../../types/rpc.js";
import { createLogger, type Logger } from "../../logging/logger.js";
import {
  DEFAULT_CONSOLE_LOGGER_LOG_LEVEL,
  defaultLoggerTransport,
} from "../../logging/console_logger_transport.js";
import {
  LoggerContext,
  LogSource,
  RestateLogLevel,
} from "../../logging/logger_transport.js";
import {
  type JournalValueCodec,
  millisOrDurationToMillis,
} from "@restatedev/restate-sdk-core";
import type { Endpoint } from "../endpoint.js";

export interface Headers {
  [name: string]: string | string[] | undefined;
}

export interface ResponseHeaders {
  [name: string]: string;
}

export interface AdditionalContext {
  [name: string]: string;
}

export interface RestateRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly extraArgs: unknown[];
  readonly abortSignal: AbortSignal;
}

export interface RestateResponse {
  readonly headers: ResponseHeaders;
  readonly statusCode: number;
  readonly body: ReadableStream<Uint8Array>;
}

export interface RestateHandler {
  handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse>;
}

const ENDPOINT_MANIFEST_V2 = "application/vnd.restate.endpointmanifest.v2+json";
const ENDPOINT_MANIFEST_V3 = "application/vnd.restate.endpointmanifest.v3+json";
const ENDPOINT_MANIFEST_V4 = "application/vnd.restate.endpointmanifest.v4+json";

/**
 * This is an internal API to support 'fetch' like handlers.
 * It supports both request-reply mode and bidirectional streaming mode.
 *
 * An individual handler will have to convert the shape of the incoming request
 * to a RestateRequest, and then pass it to this handler, and eventually convert back
 * the response.
 * Different runtimes have slightly different shapes of the incoming request, and responses.
 */
export class GenericHandler implements RestateHandler {
  private readonly identityVerifier?: vm.WasmIdentityVerifier;

  constructor(
    readonly endpoint: Endpoint,
    private readonly protocolMode: ProtocolMode,
    private readonly additionalDiscoveryFields: Partial<EndpointManifest>
  ) {
    // Setup identity verifier
    if (
      this.endpoint.keySet === undefined ||
      this.endpoint.keySet.length === 0
    ) {
      this.endpoint.rlog.warn(
        `Accepting requests without validating request signatures; handler access must be restricted`
      );
    } else {
      this.endpoint.rlog.info(
        `Validating requests using signing keys [${this.endpoint.keySet}]`
      );
      this.identityVerifier = new vm.WasmIdentityVerifier(this.endpoint.keySet);
    }

    // Set the logging level in the shared core too!
    vm.set_log_level(
      restateLogLevelToWasmLogLevel(DEFAULT_CONSOLE_LOGGER_LOG_LEVEL)
    );
  }

  // handle does not throw.
  public async handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse> {
    try {
      return await this._handle(request, context);
    } catch (e) {
      const error = ensureError(e);
      this.endpoint.rlog.error(
        "Error while handling invocation: " + (error.stack ?? error.message)
      );
      return this.toErrorResponse(
        error instanceof RestateError ? error.code : 500,
        error.message
      );
    }
  }

  private async _handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse> {
    // this is the recommended way to get the relative path from a url that may be relative or absolute
    const path = new URL(request.url, "https://example.com").pathname;
    const parsed = parseUrlComponents(path);

    if (parsed.type === "unknown") {
      const msg = `Invalid path. Allowed are /health, or /discover, or /invoke/SvcName/handlerName, but was: ${path}`;
      this.endpoint.rlog.trace(msg);
      return this.toErrorResponse(404, msg);
    }

    if (parsed.type === "health") {
      return {
        body: OnceStream(new TextEncoder().encode("OK")),
        headers: {
          "content-type": "application/text",
          "x-restate-server": X_RESTATE_SERVER,
        },
        statusCode: 200,
      };
    }

    const error = this.validateConnectionSignature(path, request.headers);
    if (error !== null) {
      return error;
    }
    if (parsed.type === "discover") {
      return this.handleDiscovery(request.headers["accept"]);
    }
    const serviceProtocolVersionString = request.headers["content-type"];
    if (typeof serviceProtocolVersionString !== "string") {
      const errorMessage = "Missing content-type header";
      this.endpoint.rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }
    const service = this.endpoint.components.get(parsed.componentName);
    if (!service) {
      const msg = `No service found for URL: ${JSON.stringify(parsed)}`;
      this.endpoint.rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    const handler = service?.handlerMatching(parsed);
    if (!handler) {
      const msg = `No service found for URL: ${JSON.stringify(parsed)}`;
      this.endpoint.rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    if (!request.body) {
      const msg = "The incoming message body was null";
      this.endpoint.rlog.error(msg);
      return this.toErrorResponse(400, msg);
    }

    return this.handleInvoke(
      service,
      handler,
      request.body,
      request.headers,
      request.extraArgs,
      request.abortSignal,
      context ?? {}
    );
  }

  private validateConnectionSignature(
    path: string,
    headers: Headers
  ): RestateResponse | null {
    if (!this.identityVerifier) {
      // not validating
      return null;
    }

    const vmHeaders = Object.entries(headers)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          new vm.WasmHeader(k, v instanceof Array ? v[0] : (v as string))
      );

    try {
      this.identityVerifier.verify_identity(path, vmHeaders);
      return null;
    } catch (e) {
      this.endpoint.rlog.error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Rejecting request as its JWT did not validate: ${e}`
      );
      return this.toErrorResponse(401, "Unauthorized");
    }
  }

  private async handleInvoke(
    service: Component,
    handler: ComponentHandler,
    body: ReadableStream<Uint8Array>,
    headers: Headers,
    extraArgs: unknown[],
    abortSignal: AbortSignal,
    additionalContext: AdditionalContext
  ): Promise<RestateResponse> {
    const journalValueCodec: JournalValueCodec = this.endpoint.journalValueCodec
      ? await this.endpoint.journalValueCodec
      : {
          encode: (entry) => entry,
          decode: (entry) => Promise.resolve(entry),
        };
    const loggerId = Math.floor(Math.random() * 4_294_967_295 /* u32::MAX */);

    try {
      // Instantiate core vm and prepare response headers
      const vmHeaders = Object.entries(headers)
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            new vm.WasmHeader(k, v instanceof Array ? v[0] : (v as string))
        );
      const coreVm = new vm.WasmVM(
        vmHeaders,
        restateLogLevelToWasmLogLevel(DEFAULT_CONSOLE_LOGGER_LOG_LEVEL),
        loggerId,
        this.endpoint.journalValueCodec !== undefined
      );
      const responseHead = coreVm.get_response_head();
      const responseHeaders = responseHead.headers.reduce(
        (headers, { key, value }) => ({
          [key]: value,
          ...headers,
        }),
        {
          "x-restate-server": X_RESTATE_SERVER,
        }
      );

      // Use a default logger that still respects the endpoint custom logger
      // We will override this later with a logger that has a LoggerContext
      // See vm_log below for more details
      invocationLoggers.set(
        loggerId,
        createLogger(
          this.endpoint.loggerTransport,
          LogSource.JOURNAL,
          undefined
        )
      );

      const inputReader = body.getReader();
      abortSignal.addEventListener(
        "abort",
        () => {
          invocationLoggers.delete(loggerId);
          void inputReader.cancel();
        },
        { once: true }
      );

      // Now buffer input entries
      while (!coreVm.is_ready_to_execute()) {
        const nextValue = await inputReader.read();
        if (nextValue.value !== undefined) {
          coreVm.notify_input(nextValue.value);
        }
        if (nextValue.done) {
          coreVm.notify_input_closed();
          break;
        }
      }

      // Get input
      const input = coreVm.sys_input();

      const invocationRequest: Request = {
        id: input.invocation_id,
        headers: input.headers.reduce((headers, { key, value }) => {
          headers.set(key, value);
          return headers;
        }, new Map()),
        attemptHeaders: Object.entries(headers).reduce(
          (headers, [key, value]) => {
            if (value !== undefined) {
              headers.set(key, value instanceof Array ? value[0] : value);
            }
            return headers;
          },
          new Map()
        ),
        body: input.input,
        extraArgs,
        attemptCompletedSignal: abortSignal,
      };

      // Prepare logger
      const loggerContext = new LoggerContext(
        input.invocation_id,
        handler.component().name(),
        handler.name(),
        handler.kind() === HandlerKind.SERVICE ? undefined : input.key,
        invocationRequest,
        additionalContext
      );
      const ctxLogger = createLogger(
        this.endpoint.loggerTransport,
        LogSource.USER,
        loggerContext,
        () => !coreVm.is_processing()
      );
      const vmLogger = createLogger(
        this.endpoint.loggerTransport,
        LogSource.JOURNAL,
        loggerContext
        // Filtering is done within the shared core
      );
      // See vm_log below for more details
      invocationLoggers.set(loggerId, vmLogger);
      if (!coreVm.is_processing()) {
        vmLogger.info("Replaying invocation.");
      } else {
        vmLogger.info("Starting invocation.");
      }

      // This promise is used to signal the end of the computation,
      // which can be either the user returns a value,
      // or an exception gets catched, or the state machine fails/suspends.
      //
      // The last case is handled internally within the ContextImpl.
      const invocationEndPromise = new CompletablePromise<void>();

      // Prepare response stream
      const responseTransformStream = new TransformStream<Uint8Array>();
      const outputWriter = responseTransformStream.writable.getWriter();

      // Prepare context
      const ctx = new ContextImpl(
        coreVm,
        input,
        ctxLogger,
        handler.kind(),
        vmLogger,
        invocationRequest,
        invocationEndPromise,
        inputReader,
        outputWriter,
        journalValueCodec,
        service.options?.asTerminalError
      );

      journalValueCodec
        .decode(input.input)
        .catch((e) =>
          Promise.reject(
            new TerminalError(
              `Failed to decode input using journal value codec: ${
                ensureError(e).message
              }`,
              {
                errorCode: 400,
              }
            )
          )
        )
        .then((decodedInput) =>
          // Invoke user handler code
          handler.invoke(ctx, decodedInput)
        )
        .then((output) => {
          // Write output result
          coreVm.sys_write_output_success(journalValueCodec.encode(output));
          coreVm.sys_end();
          vmLogger.info("Invocation completed successfully.");
        })
        .catch((e) => {
          // Convert to Error
          const error = ensureError(e, service.options?.asTerminalError);
          logError(vmLogger, error);

          // If TerminalError, handle it here.
          // NOTE: this can still fail!
          if (error instanceof TerminalError) {
            coreVm.sys_write_output_failure({
              code: error.code,
              message: error.message,
            });
            coreVm.sys_end();
            return;
          }

          // Not a terminal error, have the below catch handle it
          throw error;
        })
        .catch((e) => {
          // Handle any other error now (retryable errors)
          const error = ensureError(e);
          if (error instanceof RetryableError) {
            coreVm.notify_error_with_delay_override(
              error.message,
              error.stack,
              error.retryAfter !== undefined
                ? BigInt(millisOrDurationToMillis(error.retryAfter))
                : undefined
            );
          } else {
            coreVm.notify_error(error.message, error.stack);
          }
        })
        .finally(() => {
          invocationEndPromise.resolve();
        });

      // Let's wire up invocationEndPromise with consuming all the output and closing the streams.
      invocationEndPromise.promise
        .then(async () => {
          // Consume output till the end, write it out, then close the stream
          let nextOutput = coreVm.take_output() as
            | Uint8Array
            | null
            | undefined;
          while (nextOutput !== null && nextOutput !== undefined) {
            await outputWriter.write(nextOutput);
            nextOutput = coreVm.take_output() as Uint8Array | null | undefined;
          }
          await outputWriter.close();
          // Let's cancel the input reader, if it's still here
          inputReader.cancel().catch(() => {});
        })
        .finally(() => {
          invocationLoggers.delete(loggerId);
        })
        .catch(() => {});

      return {
        headers: responseHeaders,
        statusCode: responseHead.status_code,
        body: responseTransformStream.readable as ReadableStream<Uint8Array>,
      };
    } catch (error) {
      invocationLoggers.delete(loggerId);
      throw error;
    }
  }

  private handleDiscovery(
    acceptVersionsString: string | string[] | undefined
  ): RestateResponse {
    if (typeof acceptVersionsString !== "string") {
      const errorMessage = "Missing accept header";
      this.endpoint.rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    // Negotiate version to use
    let manifestVersion;
    if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V4)) {
      manifestVersion = 4;
    } else if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V3)) {
      manifestVersion = 3;
    } else if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V2)) {
      manifestVersion = 2;
    } else {
      const errorMessage = `Unsupported service discovery protocol version '${acceptVersionsString}'`;
      this.endpoint.rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    const discovery = {
      ...this.endpoint.discoveryMetadata,
      ...this.additionalDiscoveryFields,
      protocolMode: this.protocolMode,
    };

    const checkUnsupportedFeature = <T extends object>(
      obj: T,
      ...fields: Array<keyof T>
    ) => {
      for (const field of fields) {
        if (field in obj && obj[field] !== undefined) {
          return this.toErrorResponse(
            500,
            `The code uses the new discovery feature '${String(
              field
            )}' but the runtime doesn't support it yet (discovery protocol negotiated version ${manifestVersion}). Either remove the usage of this feature, or upgrade the runtime.`
          );
        }
      }
      return;
    };

    // Verify none of the manifest v3 configuration options are used.
    if (manifestVersion < 3) {
      for (const service of discovery.services) {
        const error = checkUnsupportedFeature(
          service,
          "journalRetention",
          "idempotencyRetention",
          "inactivityTimeout",
          "abortTimeout",
          "enableLazyState",
          "ingressPrivate"
        );
        if (error !== undefined) {
          return error;
        }
        for (const handler of service.handlers) {
          const error = checkUnsupportedFeature(
            handler,
            "journalRetention",
            "idempotencyRetention",
            "workflowCompletionRetention",
            "inactivityTimeout",
            "abortTimeout",
            "enableLazyState",
            "ingressPrivate"
          );
          if (error !== undefined) {
            return error;
          }
        }
      }
    }

    if (manifestVersion < 4) {
      // Blank the lambda compression field. No need to fail in this case.
      discovery.lambdaCompression = undefined;
      for (const service of discovery.services) {
        const error = checkUnsupportedFeature(
          service,
          "retryPolicyExponentiationFactor",
          "retryPolicyInitialInterval",
          "retryPolicyMaxAttempts",
          "retryPolicyMaxInterval",
          "retryPolicyOnMaxAttempts"
        );
        if (error !== undefined) {
          return error;
        }
        for (const handler of service.handlers) {
          const error = checkUnsupportedFeature(
            handler,
            "retryPolicyExponentiationFactor",
            "retryPolicyInitialInterval",
            "retryPolicyMaxAttempts",
            "retryPolicyMaxInterval",
            "retryPolicyOnMaxAttempts"
          );
          if (error !== undefined) {
            return error;
          }
        }
      }
    }

    const body = JSON.stringify(discovery);
    return {
      headers: {
        "content-type":
          manifestVersion === 2
            ? ENDPOINT_MANIFEST_V2
            : manifestVersion === 3
            ? ENDPOINT_MANIFEST_V3
            : ENDPOINT_MANIFEST_V4,
        "x-restate-server": X_RESTATE_SERVER,
      },
      statusCode: 200,
      body: OnceStream(new TextEncoder().encode(body)),
    };
  }

  private toErrorResponse(code: number, message: string): RestateResponse {
    return {
      headers: {
        "content-type": "application/json",
        "x-restate-server": X_RESTATE_SERVER,
      },
      statusCode: code,
      body: OnceStream(new TextEncoder().encode(JSON.stringify({ message }))),
    };
  }
}

// See vm_log below for more details
const invocationLoggers: Map<number, Logger> = new Map<number, Logger>();
const logsTextDecoder = new TextDecoder("utf-8", { fatal: false });

/**
 * The shared core propagates logs to the SDK invoking this method.
 * When possible it provides an invocationId, which is used to access the registered invocationLoggers, that should contain the logger per invocation id.
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

function restateLogLevelToWasmLogLevel(level: RestateLogLevel): vm.LogLevel {
  switch (level) {
    case RestateLogLevel.TRACE:
      return vm.LogLevel.TRACE;
    case RestateLogLevel.DEBUG:
      return vm.LogLevel.DEBUG;
    case RestateLogLevel.INFO:
      return vm.LogLevel.INFO;
    case RestateLogLevel.WARN:
      return vm.LogLevel.WARN;
    case RestateLogLevel.ERROR:
      return vm.LogLevel.ERROR;
  }
}
