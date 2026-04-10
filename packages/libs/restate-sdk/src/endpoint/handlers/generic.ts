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
  Endpoint as EndpointManifest,
  ProtocolMode,
} from "../discovery.js";
import {
  Component,
  ComponentHandler,
  InvokePathComponents,
} from "../components.js";
import { parseUrlComponents } from "../components.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { CommandError, ContextImpl } from "../../context_impl.js";
import { restoreError, sanitizeError } from "../../error_sanitization.js";
import type { InvocationId, Request } from "../../context.js";
import * as vm from "./vm/sdk_shared_core_wasm_bindings.js";
import { CompletablePromise } from "../../utils/completable_promise.js";
import { HandlerKind } from "../../types/rpc.js";
import { createLogger, type Logger } from "../../logging/logger.js";
import { DEFAULT_CONSOLE_LOGGER_LOG_LEVEL } from "../../logging/console_logger_transport.js";
import {
  LoggerContext,
  LoggerTransport,
  LogSource,
  RestateLogLevel,
} from "../../logging/logger_transport.js";
import {
  type JournalValueCodec,
  millisOrDurationToMillis,
} from "@restatedev/restate-sdk-core";
import type { Endpoint } from "../endpoint.js";
import {
  type RestateHandler,
  type Headers,
  type RestateRequest,
  type AdditionalContext,
  type RestateResponse,
  ResponseHeaders,
  InputReader,
  OutputWriter,
} from "./types.js";
import { handleDiscovery } from "./discovery.js";
import {
  errorResponse,
  invocationIdFromHeaders,
  simpleResponse,
  tryCreateContextualLogger,
} from "./utils.js";
import { destroyLogger, registerLogger } from "./core_logging.js";
import type { Hooks } from "../../hooks.js";

// Hidden symbol key used by first-party hooks to read the live
// replay/processing phase without widening the public HooksProvider API.
const HOOK_CONTEXT_IS_PROCESSING_SYMBOL = Symbol.for(
  "@restatedev/restate-sdk/hooks.isProcessing"
);

export function createRestateHandler(
  endpoint: Endpoint,
  protocolMode: ProtocolMode,
  additionalDiscoveryFields: Partial<EndpointManifest>
): RestateHandler {
  return new RestateHandlerImpl(
    endpoint,
    protocolMode,
    additionalDiscoveryFields
  );
}

/**
 * This is the RestateHandler implementation
 */
class RestateHandlerImpl implements RestateHandler {
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
  public handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): RestateResponse {
    try {
      return this._handle(request, context);
    } catch (e) {
      const error = ensureError(e);
      (
        tryCreateContextualLogger(
          this.endpoint.loggerTransport,
          request.url,
          request.headers
        ) ?? this.endpoint.rlog
      ).error(
        "Error while handling request: " + (error.stack ?? error.message)
      );
      return errorResponse(
        error instanceof RestateError ? error.code : 500,
        error.message
      );
    }
  }

  private _handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): RestateResponse {
    // this is the recommended way to get the relative path from a url that may be relative or absolute
    const path = new URL(request.url, "https://example.com").pathname;
    const parsed = parseUrlComponents(path);

    if (parsed.type === "unknown") {
      const msg = `Invalid path. Allowed are /health, or /discover, or /invoke/SvcName/handlerName, but was: ${path}`;
      this.endpoint.rlog.trace(msg);
      return errorResponse(404, msg);
    }
    if (parsed.type === "health") {
      return simpleResponse(
        200,
        {
          "content-type": "application/text",
          "x-restate-server": X_RESTATE_SERVER,
        },
        new TextEncoder().encode("OK")
      );
    }

    // Discovery and handling invocations require identity verification
    const error = this.validateConnectionSignature(path, request.headers);
    if (error !== null) {
      return error;
    }
    if (parsed.type === "discover") {
      return handleDiscovery(
        this.endpoint,
        this.protocolMode,
        this.additionalDiscoveryFields,
        request.headers["accept"]
      );
    }

    return this.handleInvoke(
      parsed,
      request.headers,
      request.extraArgs,
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
          new vm.WasmHeader(k, v instanceof Array ? v[0]! : (v as string))
      );

    try {
      this.identityVerifier.verify_identity(path, vmHeaders);
      return null;
    } catch (e) {
      this.endpoint.rlog.error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Rejecting request as its JWT did not validate: ${e}`
      );
      return errorResponse(401, "Unauthorized");
    }
  }

  private handleInvoke(
    invokePathComponent: InvokePathComponents,
    headers: Headers,
    extraArgs: unknown[],
    additionalContext: AdditionalContext
  ): RestateResponse {
    // Check if we support this protocol version
    const serviceProtocolVersionString = headers["content-type"];
    if (typeof serviceProtocolVersionString !== "string") {
      const errorMessage = "Missing content-type header";
      this.endpoint.rlog.warn(errorMessage);
      return errorResponse(415, errorMessage);
    }

    // Resolve service and handler
    const service = this.endpoint.components.get(
      invokePathComponent.componentName
    );
    if (!service) {
      const msg = `No service found for URL: ${JSON.stringify(invokePathComponent)}`;
      this.endpoint.rlog.error(msg);
      return errorResponse(404, msg);
    }
    const handler = service?.handlerMatching(invokePathComponent);
    if (!handler) {
      const msg = `No service found for URL: ${JSON.stringify(invokePathComponent)}`;
      this.endpoint.rlog.error(msg);
      return errorResponse(404, msg);
    }

    return new RestateInvokeResponse(
      service,
      handler,
      headers,
      extraArgs,
      additionalContext,
      this.endpoint.journalValueCodec,
      this.endpoint.loggerTransport
    );
  }
}

class RestateInvokeResponse implements RestateResponse {
  public headers: ResponseHeaders;
  public statusCode: number;

  private readonly loggerId: number;
  private vmLogger: Logger;
  private readonly coreVm: vm.WasmVM;

  constructor(
    private readonly service: Component,
    private readonly handler: ComponentHandler,
    private readonly attemptHeaders: Headers,
    private readonly extraArgs: unknown[],
    private readonly additionalContext: AdditionalContext,
    private readonly journalValueCodecInit:
      | Promise<JournalValueCodec>
      | undefined,
    private readonly loggerTransport: LoggerTransport
  ) {
    this.loggerId = Math.floor(Math.random() * 4_294_967_295 /* u32::MAX */);
    const isJournalCodecDefined = this.journalValueCodecInit !== undefined;

    // Instantiate core vm and prepare response headers
    const vmHeaders = Object.entries(this.attemptHeaders)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          new vm.WasmHeader(k, v instanceof Array ? v[0]! : (v as string))
      );
    this.coreVm = new vm.WasmVM(
      vmHeaders,
      restateLogLevelToWasmLogLevel(DEFAULT_CONSOLE_LOGGER_LOG_LEVEL),
      this.loggerId,
      isJournalCodecDefined,
      handler.executionOptions.explicitCancellation ?? false
    );
    const responseHead = this.coreVm.get_response_head();
    this.statusCode = responseHead.status_code;
    this.headers = responseHead.headers.reduce(
      (headers, { key, value }) => ({
        [key]: value,
        ...headers,
      }),
      {
        "x-restate-server": X_RESTATE_SERVER,
      }
    );
    this.vmLogger = createLogger(
      this.loggerTransport,
      LogSource.JOURNAL,
      new LoggerContext(
        invocationIdFromHeaders(this.attemptHeaders),
        this.service.name(),
        this.handler.name(),
        undefined,
        undefined,
        this.additionalContext
      )
    );
  }

  async process({
    inputReader,
    outputWriter,
    abortSignal,
  }: {
    inputReader: InputReader;
    outputWriter: OutputWriter;
    abortSignal: AbortSignal;
  }): Promise<void> {
    abortSignal.addEventListener(
      "abort",
      () => {
        // In any case, on abort remove the invocation logger to avoid memory leaks
        destroyLogger(this.loggerId);

        // Poison the VM so the handler fails on the next VM call.
        // We only read new input from the server when a Restate command is
        // waiting for a response. If no command has been issued, the server's
        // abort signal is never read.
        // Deferred with setImmediate so in-flight PromisesExecutor work
        // gets to deliver the specific protocol-level error first.
        setImmediate(() => {
          const msg = "Connection closed";
          this.coreVm.notify_error(msg, msg);
        });
      },
      { once: true }
    );
    // Use a default logger that still respects the endpoint custom logger
    // We will override this later with a logger that has a LoggerContext
    // See vm_log below for more details
    registerLogger(this.loggerId, this.vmLogger);

    const journalValueCodec: JournalValueCodec = this.journalValueCodecInit
      ? await this.journalValueCodecInit
      : {
          encode: (entry) => entry,
          decode: (entry) => Promise.resolve(entry),
        };

    // This promise is used to signal the end of the computation,
    // which can be either the user returns a value,
    // or an exception gets caught, or the state machine fails/suspends.
    //
    // The last case is handled internally within the ContextImpl.
    const invocationEndPromise = new CompletablePromise<void>();
    let ctx: ContextImpl;

    // Initial phase before running user code
    // -> Buffer in shared core the journal entries
    // -> Initiate loggers
    // -> Initialize the ContextImpl
    try {
      // Buffer journal inside shared core
      await bufferJournalReplayInCoreVm(this.coreVm, inputReader);

      // Get input from coreVm to build the request object
      const input = this.coreVm.sys_input();
      const invocationRequest: Request = {
        target: {
          service: this.service.name(),
          handler: this.handler.name(),
          key: input.key || undefined,
          toString() {
            return this.key !== undefined
              ? `${this.service}/${this.key}/${this.handler}`
              : `${this.service}/${this.handler}`;
          },
        },
        id: input.invocation_id as InvocationId,
        headers: input.headers.reduce((headers, { key, value }) => {
          headers.set(key, value);
          return headers;
        }, new Map()),
        attemptHeaders: Object.entries(this.attemptHeaders).reduce(
          (headers, [key, value]) => {
            if (value !== undefined) {
              headers.set(key, value instanceof Array ? value[0] : value);
            }
            return headers;
          },
          new Map()
        ),
        body: input.input,
        extraArgs: this.extraArgs,
        attemptCompletedSignal: abortSignal,
      };

      // Prepare logger
      const loggerContext = new LoggerContext(
        input.invocation_id,
        this.handler.component().name(),
        this.handler.name(),
        this.handler.kind() === HandlerKind.SERVICE ? undefined : input.key,
        invocationRequest,
        this.additionalContext
      );
      const ctxLogger = createLogger(
        this.loggerTransport,
        LogSource.USER,
        loggerContext,
        () => !this.coreVm.is_processing()
      );
      // Override the vmLogger created before with more info!
      this.vmLogger = createLogger(
        this.loggerTransport,
        LogSource.JOURNAL,
        loggerContext
        // Filtering is done within the shared core
      );

      // See vm_log below for more details
      registerLogger(this.loggerId, this.vmLogger);
      if (!this.coreVm.is_processing()) {
        this.vmLogger.info("Replaying invocation.");
      } else {
        this.vmLogger.info("Starting invocation.");
      }

      // Prepare context
      ctx = new ContextImpl(
        this.coreVm,
        input,
        ctxLogger,
        this.handler.kind(),
        this.vmLogger,
        invocationRequest,
        invocationEndPromise,
        inputReader,
        outputWriter,
        journalValueCodec,
        this.handler.executionOptions
      );
    } catch (e) {
      // That's "preflight" failure cases, where stuff fails before running user code
      // In this scenario, we close the coreVm, then flush and close
      const error = ensureError(e);
      this.coreVm.notify_error(error.message, error.message);
      await flushAndClose(
        this.coreVm,
        this.vmLogger,
        inputReader,
        outputWriter
      );
      return;
    }

    // Run user code. Errors that reach the handler or interceptor code
    // (handler throws, interceptor throws, entry completes with terminal
    // failure) propagate naturally. Errors where the handler is stuck on
    // an await that will never settle (e.g. suspension, retryable run
    // error) are broken out by raceWithAttemptEnd, which races against
    // invocationEndPromise — rejected by ContextImpl when the attempt ends.
    try {
      await startUserHandler(
        ctx,
        this.service,
        this.handler,
        journalValueCodec
      );
    } catch (e) {
      notifyError(e, ctx, this.handler.executionOptions.asTerminalError);
    } finally {
      await flushAndClose(
        this.coreVm,
        this.vmLogger,
        inputReader,
        outputWriter
      );
    }
  }
}

async function bufferJournalReplayInCoreVm(
  coreVm: vm.WasmVM,
  inputReader: InputReader
) {
  while (!coreVm.is_ready_to_execute()) {
    const nextValue = await inputReader.next();
    if (nextValue.done) {
      coreVm.notify_input_closed();
      break;
    }
    if (nextValue.value !== undefined) {
      coreVm.notify_input(nextValue.value);
    }
  }
}

async function startUserHandler(
  ctx: ContextImpl,
  service: Component,
  handler: ComponentHandler,
  journalValueCodec: JournalValueCodec
) {
  // Instantiate hooks from providers.
  // If a provider throws, the same rules as handler failures apply:
  // TerminalError → terminate invocation, other errors → retry.
  const hooks: Hooks[] = [];
  for (const provider of handler.executionOptions.hooks ?? []) {
    const hookContext: { request: Request } = {
      request: ctx.request(),
    };
    Object.defineProperty(hookContext, HOOK_CONTEXT_IS_PROCESSING_SYMBOL, {
      value: () => ctx.isProcessing(),
      enumerable: false,
    });
    hooks.push(provider(hookContext));
  }

  // Compose interceptor.handler into a single interceptor (first = outermost)
  const handlerInterceptor = composeInterceptors(
    hooks.map((h) => h.interceptor?.handler).filter(isDefined)
  );

  ctx.setRunInterceptor(
    composeInterceptors(hooks.map((h) => h.interceptor?.run).filter(isDefined))
  );

  let encodedOutput: Uint8Array | undefined;
  await raceWithAttemptEnd(
    ctx,
    handlerInterceptor
  )(async () => {
    const decodedInput = await journalValueCodec
      .decode(ctx.request().body)
      .catch((e) =>
        // Re-throw as terminal error, to fail on input errors
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
      );

    // Then run user code
    const output = await handler.invoke(ctx, decodedInput);

    // Encode user code output
    encodedOutput = journalValueCodec.encode(output);
  });

  // Interceptor chain completed without error — commit the result.
  // sys_end() is called here (after interceptors) so that interceptor
  // errors after next() correctly prevent the invocation from succeeding.
  ctx.coreVm.sys_write_output_success(encodedOutput!);
  ctx.coreVm.sys_end();
  ctx.vmLogger.info("Invocation completed successfully.");
}

/**
 * Classifies the error and notifies the VM. Called from the process() catch
 * block — the single place that decides how to report errors to the VM.
 */
function notifyError(
  e: unknown,
  ctx: ContextImpl,
  asTerminalError?: (error: unknown) => TerminalError | undefined
) {
  // Command-specific errors from ContextImpl carry metadata the VM needs
  // for command correlation. Check before ensureError to preserve the type.
  if (e instanceof CommandError) {
    const cause = ensureError(e.cause);
    logError(ctx.vmLogger, cause);
    if (e.hasCommandIndex) {
      // Completion failure — command exists in the journal
      ctx.coreVm.notify_error_for_specific_command(
        cause.message,
        cause.stack,
        e.commandType,
        e.commandIndex!,
        null
      );
    } else {
      // Preparation failure — command not yet issued
      ctx.coreVm.notify_error_for_next_command(
        cause.message,
        cause.stack,
        e.commandType
      );
    }
    return;
  }

  // Handler/interceptor errors
  const error = ensureError(e, asTerminalError);
  logError(ctx.vmLogger, error);

  try {
    if (error instanceof TerminalError) {
      // Terminal: write the failure as the invocation output
      ctx.coreVm.sys_write_output_failure({
        code: error.code,
        message: error.message,
        metadata: Object.entries(error.metadata ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      });
      ctx.coreVm.sys_end();
    } else if (error instanceof RetryableError) {
      // Retryable with explicit delay
      ctx.coreVm.notify_error_with_delay_override(
        error.message,
        error.stack,
        error.retryAfter !== undefined
          ? BigInt(millisOrDurationToMillis(error.retryAfter))
          : undefined
      );
    } else {
      // Transient error — VM decides retry policy
      ctx.coreVm.notify_error(error.message, error.stack);
    }
  } catch (vmError) {
    // Safety net: if sys_write_output_failure or other VM calls fail,
    // fall back to notify_error.
    const inner = ensureError(vmError);
    ctx.coreVm.notify_error(inner.message, inner.stack);
  }
}

async function flushAndClose(
  coreVm: vm.WasmVM,
  vmLogger: Logger,
  inputReader: InputReader,
  outputWriter: OutputWriter
): Promise<void> {
  let inputClosed = false;
  try {
    // Consume output till the end, write it out, then close the stream
    let nextOutput = coreVm.take_output() as Uint8Array | null | undefined;
    while (nextOutput !== null && nextOutput !== undefined) {
      await outputWriter.write(nextOutput);
      nextOutput = coreVm.take_output() as Uint8Array | null | undefined;
    }

    // --- After this point, we should have flushed the shared core internal buffer

    // Let's make sure we properly close the request stream before closing the response stream
    while (!inputClosed) {
      try {
        const res = await inputReader.next();
        inputClosed = res.done ?? false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        inputClosed = true;
      }
    }

    // Close the response stream
    await outputWriter.close();
  } catch (e) {
    // In case of failure, we can do little here except just logging stuff out,
    // because outputWriter is not usable here.
    const error = ensureError(e);
    const abortErrorOnWrite = isAbortErrorOnWrite(error);

    if (inputClosed && abortErrorOnWrite) {
      // Because we closed the input already,
      // these errors are benign and are caused by
      // synchronization issues wrt closing the response stream in the runtime
      // This will be fixed in the runtime with https://github.com/restatedev/restate/issues/4456
      return;
    }

    if (abortErrorOnWrite) {
      vmLogger.error(
        "Got abort error from connection: " +
          error.message +
          "\n" +
          "This might indicate that:\n" +
          "* The restate-server aborted the connection after hitting the 'abort-timeout'\n" +
          "* The connection with the restate-server was lost\n" +
          "\n" +
          "Please check the invocation in the Restate UI for more details."
      );
    } else {
      vmLogger.error(
        "Error while handling request: " + (error.stack ?? error.message)
      );
    }
  }
}

function isAbortErrorOnWrite(error: Error) {
  return (
    error.name === "AbortError" ||
    error.message === "Invalid state: WritableStream is closed" ||
    /**
     * Node stream closed error thrown on writes
     */
    (error as { code?: string }).code === "ERR_HTTP2_INVALID_STREAM"
  );
}

// -- Hook composition utils --------------------------------------------------

type InterceptorFn<Args extends unknown[]> = (
  ...args: [...Args, () => Promise<void>]
) => Promise<void>;

function composeInterceptors<Args extends unknown[]>(
  interceptors: InterceptorFn<Args>[]
): InterceptorFn<Args> {
  return interceptors.reduceRight<InterceptorFn<Args>>(
    (innerInterceptor, interceptor) =>
      (...args) => {
        const context = args.slice(0, -1) as unknown as Args;
        const callback = args.at(-1) as () => Promise<void>;
        return interceptor(...context, () =>
          innerInterceptor(...context, callback)
        );
      },
    (...args) => (args.at(-1) as () => Promise<void>)()
  );
}

/**
 * Wraps an interceptor so that both `next()` and the interceptor body race
 * against `invocationEndPromise`. When the attempt ends (suspension, retryable
 * error, etc.), the promise rejects and the interceptor chain unwinds through
 * catch/finally blocks — preventing interceptors from hanging on a `next()`
 * that will never settle.
 *
 * SDK-internal metadata (CommandError, retryAfter) is stripped before the
 * interceptor sees the error and restored after the chain exits.
 */
function raceWithAttemptEnd<Args extends unknown[]>(
  ctx: ContextImpl,
  interceptor: InterceptorFn<Args>
): InterceptorFn<Args> {
  return (...args) => {
    let originalError: unknown;

    // Strip SDK metadata before interceptors see the error.
    // Store the original in the closure for restoration after the chain.
    const signal = ctx.invocationEndPromise.promise.catch((e) => {
      originalError = e;
      throw sanitizeError(e);
    }) as Promise<never>;

    const originalNext = args.at(-1) as () => Promise<void>;
    const racingNext = () => Promise.race([originalNext(), signal]);
    const newArgs = [...args.slice(0, -1), racingNext] as unknown as [
      ...Args,
      () => Promise<void>,
    ];

    return Promise.race([interceptor(...newArgs), signal]).catch((e) => {
      // Restore SDK metadata after the interceptor chain exits.
      if (originalError !== undefined) {
        throw restoreError(e, originalError);
      }
      throw e;
    });
  };
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value != null;
}

// -- Logging utils -----------------------------------------------------------

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
