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

export type InputReaderNextResult =
  | { done: false | undefined; value: Uint8Array }
  | { done: true; value: undefined };

export type InputReader = AsyncIterator<Uint8Array>;

export interface OutputWriter {
  // Returns when data is flushed
  write(value: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RestateResponse {
  readonly headers: ResponseHeaders;
  readonly statusCode: number;

  // Promise resolved when the request has been fully processed,
  // the last message has been written out,
  // and outputStream has been closed.
  process(value: {
    inputReader: InputReader;
    outputWriter: OutputWriter;
    abortSignal: AbortSignal;
  }): Promise<void>;
}

export interface RestateHandler {
  // The endpoint this handler is serving
  endpoint: Endpoint;

  handle(request: RestateRequest, context?: AdditionalContext): RestateResponse;
}
