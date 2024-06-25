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

import { rlog } from "../../logger.js";
import { RequestResponseConnection } from "../../connection/request_response_connection.js";
import { InvocationBuilder } from "../../invocation.js";
import { streamDecoder } from "../../io/decoder.js";
import { StateMachine } from "../../state_machine.js";
import { ensureError } from "../../types/errors.js";
import {
  OUTPUT_ENTRY_MESSAGE_TYPE,
  isServiceProtocolVersionSupported,
  parseServiceProtocolVersion,
  selectSupportedServiceDiscoveryProtocolVersion,
  serviceDiscoveryProtocolVersionToHeaderValue,
  serviceProtocolVersionToHeaderValue,
} from "../../types/protocol.js";
import { ProtocolMode } from "../../types/discovery.js";
import type { ComponentHandler } from "../../types/components.js";
import { parseUrlComponents } from "../../types/components.js";
import { validateRequestSignature } from "../request_signing/validate.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { ServiceDiscoveryProtocolVersion } from "../../generated/proto/discovery_pb.js";
import type { ServiceProtocolVersion } from "../../generated/proto/protocol_pb.js";
import type { EndpointBuilder } from "../endpoint_builder.js";
import {
  type ReadableStream,
  TransformStream,
  type TransformStreamDefaultController,
} from "node:stream/web";
import { RestateBidiConnection } from "../../connection/bidi_connection.js";

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
}

export interface RestateResponse {
  readonly headers: ResponseHeaders;
  readonly statusCode: number;
  readonly body: ReadableStream<Uint8Array> | Uint8Array;
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
  constructor(
    private readonly endpoint: EndpointBuilder,
    private readonly protocolMode: ProtocolMode
  ) {
    if (!this.endpoint.keySet) {
      rlog.warn(
        `Accepting requests without validating request signatures; handler access must be restricted`
      );
    } else {
      rlog.info(
        `Validating requests using signing keys [${Array.from(
          this.endpoint.keySet.keys()
        )}]`
      );
    }
  }

  public async handle(
    request: RestateRequest,
    context?: AdditionalContext
  ): Promise<RestateResponse> {
    const path = request.url;

    const error = await this.validateConnectionSignature(path, request.headers);
    if (error !== null) {
      return error;
    }

    const parsed = parseUrlComponents(path);
    if (!parsed) {
      const msg = `Invalid path: path doesn't end in /invoke/SvcName/handlerName and also not in /discover: ${path}`;
      rlog.trace(msg);
      return this.toErrorResponse(404, msg);
    }
    if (parsed === "discovery") {
      return this.handleDiscovery(request.headers["accept"]);
    }
    const serviceProtocolVersionString = request.headers["content-type"];
    if (typeof serviceProtocolVersionString !== "string") {
      const errorMessage = "Missing content-type header";
      rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }
    const serviceProtocolVersion = parseServiceProtocolVersion(
      serviceProtocolVersionString
    );
    if (!isServiceProtocolVersionSupported(serviceProtocolVersion)) {
      const errorMessage = `Unsupported service protocol version '${serviceProtocolVersionString}'`;
      rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }
    const method = this.endpoint.componentByName(parsed.componentName);
    if (!method) {
      const msg = `No service found for URL: ${JSON.stringify(parsed)}`;
      rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    const handler = method?.handlerMatching(parsed);
    if (!handler) {
      const msg = `No service found for URL: ${JSON.stringify(parsed)}`;
      rlog.error(msg);
      return this.toErrorResponse(404, msg);
    }
    if (!request.body) {
      const msg = "The incoming message body was null";
      rlog.error(msg);
      return this.toErrorResponse(400, msg);
    }
    switch (this.protocolMode) {
      case ProtocolMode.REQUEST_RESPONSE:
        return this.handleInvoke(
          handler,
          request.body,
          request.headers,
          serviceProtocolVersion,
          context ?? {}
        );
      case ProtocolMode.BIDI_STREAM:
        return this.handleInvokeBidi(
          handler,
          request.body,
          request.headers,
          serviceProtocolVersion,
          context ?? {}
        );
    }
  }

  private async validateConnectionSignature(
    path: string,
    headers: Headers
  ): Promise<RestateResponse | null> {
    if (!this.endpoint.keySet) {
      // not validating
      return null;
    }

    try {
      const validateResponse = await validateRequestSignature(
        this.endpoint.keySet,
        path,
        headers
      );

      if (!validateResponse.valid) {
        rlog.error(
          `Rejecting request as its JWT did not validate: ${
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            validateResponse.error
          }`
        );
        return this.toErrorResponse(401, "Unauthorized");
      } else {
        return null;
      }
    } catch (e) {
      const error = ensureError(e);
      rlog.error(
        "Error while attempting to validate request signature: " +
          (error.stack ?? error.message)
      );
      return this.toErrorResponse(401, "Unauthorized");
    }
  }

  private async handleInvoke(
    handler: ComponentHandler,
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string | string[] | undefined>,
    serviceProtocolVersion: ServiceProtocolVersion,
    context: AdditionalContext
  ): Promise<RestateResponse> {
    try {
      // build the previous journal from the events
      const journalBuilder = new InvocationBuilder(handler);

      let alreadyCompleted = false;
      for await (const msg of body.pipeThrough(streamDecoder())) {
        if (
          !alreadyCompleted &&
          msg.messageType === OUTPUT_ENTRY_MESSAGE_TYPE
        ) {
          alreadyCompleted = true;
        }
        journalBuilder.handleMessage(msg);
      }

      // set up and invoke the state machine
      const connection = new RequestResponseConnection(
        headers,
        alreadyCompleted
      );
      const invocation = journalBuilder.build();
      const stateMachine = new StateMachine(
        connection,
        invocation,
        this.protocolMode,
        handler.kind(),
        invocation.inferLoggerContext(context)
      );
      await stateMachine.invoke();
      const result = await connection.getResult();

      return {
        headers: {
          "content-type": serviceProtocolVersionToHeaderValue(
            serviceProtocolVersion
          ),
          "x-restate-server": X_RESTATE_SERVER,
        },
        statusCode: 200,
        body: result,
      };
    } catch (e) {
      const error = ensureError(e);
      rlog.error(error.message);
      rlog.error(error.stack);
      return this.toErrorResponse(500, error.message);
    }
  }

  private async handleInvokeBidi(
    handler: ComponentHandler,
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string | string[] | undefined>,
    serviceProtocolVersion: ServiceProtocolVersion,
    context: AdditionalContext
  ): Promise<RestateResponse> {
    let responseController: TransformStreamDefaultController<Uint8Array>;
    const responseBody = new TransformStream<Uint8Array>({
      start: (ctrl) => {
        responseController =
          ctrl as TransformStreamDefaultController<Uint8Array>;
      },
    });
    const connection = RestateBidiConnection.from(headers, {
      readable: body,
      writable: responseBody.writable,
    });

    // step 1: collect all journal events
    const journalBuilder = new InvocationBuilder(handler);
    connection.pipeToConsumer(journalBuilder);
    try {
      await journalBuilder.completion();
    } finally {
      // ensure GC friendliness, also in case of errors
      connection.removeCurrentConsumer();
    }

    // step 2: create the state machine
    const invocation = journalBuilder.build();
    const stateMachine = new StateMachine(
      connection,
      invocation,
      this.protocolMode,
      handler.kind(),
      invocation.inferLoggerContext(context)
    );
    connection.pipeToConsumer(stateMachine);

    // step 3: invoke the function

    // This call would propagate errors in the state machine logic, but not errors
    // in the application function code. Ending a function with an error as well
    // as failign an invocation and being retried are perfectly valid actions from the
    // SDK's perspective.
    stateMachine
      .invoke()
      .catch((e) => responseController.error(e)) // in bidi case the best we can do is abort the connection
      .finally(() => connection.removeCurrentConsumer());

    return {
      headers: {
        "content-type": serviceProtocolVersionToHeaderValue(
          serviceProtocolVersion
        ),
        "x-restate-server": X_RESTATE_SERVER,
      },
      statusCode: 200,
      body: responseBody.readable as ReadableStream<Uint8Array>,
    };
  }

  private handleDiscovery(
    acceptVersionsString: string | string[] | undefined
  ): RestateResponse {
    if (typeof acceptVersionsString !== "string") {
      const errorMessage = "Missing accept header";
      rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    const serviceDiscoveryProtocolVersion =
      selectSupportedServiceDiscoveryProtocolVersion(acceptVersionsString);

    if (
      serviceDiscoveryProtocolVersion ===
      ServiceDiscoveryProtocolVersion.SERVICE_DISCOVERY_PROTOCOL_VERSION_UNSPECIFIED
    ) {
      const errorMessage = `Unsupported service discovery protocol version '${acceptVersionsString}'`;
      rlog.warn(errorMessage);
      return this.toErrorResponse(415, errorMessage);
    }

    const discovery = this.endpoint.computeDiscovery(this.protocolMode);

    let body;

    if (
      serviceDiscoveryProtocolVersion === ServiceDiscoveryProtocolVersion.V1
    ) {
      body = JSON.stringify(discovery);
    } else {
      // should not be reached since we check for compatibility before
      throw new Error(
        `Unsupported service discovery protocol version: ${serviceDiscoveryProtocolVersion}`
      );
    }

    return {
      headers: {
        "content-type": serviceDiscoveryProtocolVersionToHeaderValue(
          serviceDiscoveryProtocolVersion
        ),
        "x-restate-server": X_RESTATE_SERVER,
      },
      statusCode: 200,
      body: new TextEncoder().encode(body),
    };
  }

  private toErrorResponse(code: number, message: string): RestateResponse {
    return {
      headers: {
        "content-type": "text/plain",
        "x-restate-server": X_RESTATE_SERVER,
      },
      statusCode: code,
      body: new TextEncoder().encode(JSON.stringify({ message })),
    };
  }
}
