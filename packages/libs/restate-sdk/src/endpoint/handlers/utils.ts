import {
  LoggerContext,
  LogSource,
  LoggerTransport,
} from "../../logging/logger_transport.js";
import type { Headers, ResponseHeaders, RestateResponse } from "./types.js";
import { createLogger, Logger } from "../../logging/logger.js";
import { parseUrlComponents } from "../components.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";

export function tryCreateContextualLogger(
  loggerTransport: LoggerTransport,
  url: string,
  headers: Headers,
  additionalContext?: { [name: string]: string }
): Logger | undefined {
  try {
    const path = new URL(url, "https://example.com").pathname;
    const parsed = parseUrlComponents(path);
    if (parsed.type !== "invoke") {
      return undefined;
    }
    const invocationId = invocationIdFromHeaders(headers);
    return createLogger(
      loggerTransport,
      LogSource.SYSTEM,
      new LoggerContext(
        invocationId,
        parsed.componentName,
        parsed.handlerName,
        undefined,
        undefined,
        additionalContext
      )
    );
  } catch {
    return undefined;
  }
}

export function invocationIdFromHeaders(headers: Headers) {
  const invocationIdHeader = headers["x-restate-invocation-id"];
  const invocationId =
    typeof invocationIdHeader === "string"
      ? invocationIdHeader
      : Array.isArray(invocationIdHeader)
        ? (invocationIdHeader[0] ?? "unknown id")
        : "unknown id";
  return invocationId;
}

export function errorResponse(code: number, message: string): RestateResponse {
  return simpleResponse(
    code,
    {
      "content-type": "application/json",
      "x-restate-server": X_RESTATE_SERVER,
    },
    new TextEncoder().encode(JSON.stringify({ message }))
  );
}

export function simpleResponse(
  statusCode: number,
  headers: ResponseHeaders,
  body: Uint8Array
): RestateResponse {
  return {
    headers,
    statusCode,
    async process({ inputStream, outputStream }): Promise<void> {
      if (inputStream !== undefined) {
        // Drain the input stream
        const reader = inputStream.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      const writer = outputStream.getWriter();
      await writer.write(body);
      // This closes both the writer and the stream!!!
      await writer.close();
    },
  };
}
