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
  /**
   * Drive the full response lifecycle.
   *
   * Implementations own the order of things: they must call {@link writeHead}
   * exactly once before the first {@link outputWriter.write}, read any
   * {@link inputReader} content they need, write the body, and finally call
   * {@link outputWriter.close}.
   *
   * {@link RestateHandler.handle} returns responses wrapped in a safety layer
   * that emits a 500 fallback if `process()` rejects before {@link writeHead}
   * or resolves without committing a head, and closes the output stream on
   * every path. Adapters can treat transport failures as logging concerns.
   */
  process(value: {
    inputReader: InputReader;
    outputWriter: OutputWriter;
    writeHead: (statusCode: number, headers: ResponseHeaders) => void;
    abortSignal: AbortSignal;
  }): Promise<void>;
}

export interface RestateHandler {
  // The endpoint this handler is serving
  endpoint: Endpoint;

  handle(request: RestateRequest, context?: AdditionalContext): RestateResponse;
}
