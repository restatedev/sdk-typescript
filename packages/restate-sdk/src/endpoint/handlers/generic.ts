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
  RestateError,
  SUSPENDED_ERROR_CODE,
  TerminalError,
} from "../../types/errors.js";
import type { ProtocolMode } from "../../types/discovery.js";
import type { ComponentHandler } from "../../types/components.js";
import { parseUrlComponents } from "../../types/components.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import type { EndpointBuilder } from "../endpoint_builder.js";
import { type ReadableStream, TransformStream } from "node:stream/web";
import { OnceStream } from "../../utils/streams.js";
import { ContextImpl } from "../../context_impl.js";
import {
  createRestateConsole,
  DEFAULT_LOGGER_LOG_LEVEL,
  defaultLogger,
  LoggerContext,
  LogSource,
  RestateLogLevel,
} from "../../logger.js";
import * as vm from "./vm/sdk_shared_core_wasm_bindings.js";
import { CompletablePromise } from "../../utils/completable_promise.js";
import { HandlerKind } from "../../types/rpc.js";

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
}

export interface RestateResponse {
  readonly headers: ResponseHeaders;
  readonly statusCode: number;
  readonly body: ReadableStream<Uint8Array>;
}

export enum ServiceDiscoveryProtocolVersion {
  /**
   * @generated from enum value: SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED = 0;
   */
  SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED = 0,

  /**
   * initial service discovery protocol version using endpoint_manifest_schema.json
   *
   * @generated from enum value: V1 = 1;
   */
  V1 = 1,
}

export interface RestateHandler {
  handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse>;
}

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
    readonly endpoint: EndpointBuilder,
    private readonly protocolMode: ProtocolMode
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
    switch (DEFAULT_LOGGER_LOG_LEVEL) {
      case RestateLogLevel.TRACE:
        vm.set_log_level(vm.LogLevel.TRACE);
        break;
      case RestateLogLevel.DEBUG:
        vm.set_log_level(vm.LogLevel.DEBUG);
        break;
      case RestateLogLevel.INFO:
        vm.set_log_level(vm.LogLevel.INFO);
        break;
      case RestateLogLevel.WARN:
        vm.set_log_level(vm.LogLevel.WARN);
        break;
      case RestateLogLevel.ERROR:
        vm.set_log_level(vm.LogLevel.ERROR);
        break;
    }
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
      return this.toErrorResponse(500, error.message);
    }
  }

  private async _handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse> {
    // this is the recommended way to get the relative path from a url that may be relative or absolute
    const path = new URL(request.url, "https://example.com").pathname;
    const parsed = parseUrlComponents(path);

    const error = this.validateConnectionSignature(path, request.headers);
    if (error !== null) {
      return error;
    }

    if (parsed.type === "unknown") {
      const msg = `Invalid path: path doesn't end in /invoke/SvcName/handlerName and also not in /discover: ${path}`;
      this.endpoint.rlog.trace(msg);
      return this.toErrorResponse(404, msg);
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
    const method = this.endpoint.componentByName(parsed.componentName);
    if (!method) {
      const msg = `No service found for URL: ${JSON.stringify(parsed)}`;
      this.endpoint.rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    const handler = method?.handlerMatching(parsed);
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
      handler,
      request.body,
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
    handler: ComponentHandler,
    body: ReadableStream<Uint8Array>,
    headers: Headers,
    extraArgs: unknown[],
    additionalContext: AdditionalContext
  ): Promise<RestateResponse> {
    // Instantiate core vm and prepare response headers
    const vmHeaders = Object.entries(headers)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          new vm.WasmHeader(k, v instanceof Array ? v[0] : (v as string))
      );
    const coreVm = new vm.WasmVM(vmHeaders);
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

    const inputReader = body.getReader();

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

    // Prepare context
    const console = createRestateConsole(
      this.endpoint.logger,
      LogSource.USER,
      new LoggerContext(
        input.invocation_id,
        handler.component().name(),
        handler.name(),
        handler.kind() === HandlerKind.SERVICE ? undefined : input.key,
        additionalContext
      ),
      () => !coreVm.is_processing()
    );

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
      console,
      handler.kind(),
      headers,
      extraArgs,
      invocationEndPromise,
      inputReader,
      outputWriter
    );

    // Finally invoke user handler
    handler
      .invoke(ctx, input.input)
      .then((bytes) => {
        coreVm.sys_write_output_success(bytes);
        coreVm.sys_end();
      })
      .catch((e) => {
        const error = ensureError(e);
        if (
          !(error instanceof RestateError) ||
          error.code !== SUSPENDED_ERROR_CODE
        ) {
          console.warn("Function completed with an error.\n", error);
        }

        if (error instanceof TerminalError) {
          coreVm.sys_write_output_failure({
            code: error.code,
            message: error.message,
          });
          coreVm.sys_end();
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
        let nextOutput = coreVm.take_output() as Uint8Array | null | undefined;
        while (nextOutput !== null && nextOutput !== undefined) {
          await outputWriter.write(nextOutput);
          nextOutput = coreVm.take_output() as Uint8Array | null | undefined;
        }
        await outputWriter.close();
        // Let's cancel the input reader, if it's still here
        inputReader.cancel().catch(() => {});
      })
      .catch(() => {});

    return {
      headers: responseHeaders,
      statusCode: responseHead.status_code,
      body: responseTransformStream.readable as ReadableStream<Uint8Array>,
    };
  }

  private handleDiscovery(
    acceptVersionsString: string | string[] | undefined
  ): RestateResponse {
    if (typeof acceptVersionsString !== "string") {
      const errorMessage = "Missing accept header";
      this.endpoint.rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    if (
      !acceptVersionsString.includes(
        "application/vnd.restate.endpointmanifest.v1+json"
      )
    ) {
      const errorMessage = `Unsupported service discovery protocol version '${acceptVersionsString}'`;
      this.endpoint.rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    const discovery = this.endpoint.computeDiscovery(this.protocolMode);
    const body = JSON.stringify(discovery);

    return {
      headers: {
        "content-type": "application/vnd.restate.endpointmanifest.v1+json",
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

/// This is used by the shared core!
export function vm_log(level: vm.LogLevel, str: string) {
  defaultLogger(
    {
      level: wasmLogLevelToRestateLogLevel(level),
      replaying: false,
      source: LogSource.JOURNAL,
    },
    str
  );
}
