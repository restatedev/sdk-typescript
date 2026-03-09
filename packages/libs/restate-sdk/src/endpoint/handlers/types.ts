import { ReadableStream, type WritableStream } from "node:stream/web";
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
  readonly extraArgs: unknown[];
}

export interface RestateResponse {
  readonly headers: ResponseHeaders;
  readonly statusCode: number;

  // Promise resolved when the request has been fully processed,
  // the last message has been written out,
  // and outputStream has been closed.
  process(value: {
    inputStream?: ReadableStream<Uint8Array>;
    outputStream: WritableStream<Uint8Array>;
    abortSignal: AbortSignal;
  }): Promise<void>;
}

export interface RestateHandler {
  // The endpoint this handler is serving
  endpoint: Endpoint;

  handle(request: RestateRequest, context?: AdditionalContext): RestateResponse;
}
