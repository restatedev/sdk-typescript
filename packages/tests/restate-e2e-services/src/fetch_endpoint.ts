// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as http2 from "http2";
import { Readable, Writable } from "node:stream";
import * as restateFetch from "@restatedev/restate-sdk/fetch";
import type { ComponentDefinition } from "./services.js";

function installPromiseWithResolversPolyfill() {
  if (typeof Promise.withResolvers === "function") {
    return;
  }

  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      });
      return { promise, resolve, reject };
    },
  });
}

installPromiseWithResolversPolyfill();

function toWebHeaders(headers: http2.IncomingHttpHeaders): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":")) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        webHeaders.append(key, item);
      }
    } else if (value !== undefined) {
      webHeaders.set(key, value);
    }
  }
  return webHeaders;
}

function requestUrl(req: http2.Http2ServerRequest, port: number): URL {
  const scheme = req.headers[":scheme"] ?? "http";
  const authority =
    req.headers[":authority"] ?? req.headers.host ?? `127.0.0.1:${port}`;
  return new URL(req.url, `${scheme}://${authority}`);
}

async function handleFetchRequest(
  fetchHandler: ReturnType<typeof restateFetch.createEndpointHandler>,
  port: number,
  req: http2.Http2ServerRequest,
  res: http2.Http2ServerResponse
) {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  req.once("close", abort);
  res.once("close", abort);

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : (Readable.toWeb(req) as ReadableStream<Uint8Array>);

  try {
    const response = await fetchHandler(
      new Request(requestUrl(req, port), {
        method: req.method,
        headers: toWebHeaders(req.headers),
        body,
        signal: abortController.signal,
        duplex: body ? "half" : undefined,
      } as RequestInit & { duplex?: "half" })
    );
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.writeHead(response.status, responseHeaders);
    if (response.body) {
      await response.body.pipeTo(
        Writable.toWeb(res) as WritableStream<Uint8Array>
      );
    } else {
      res.end();
    }
  } catch (e) {
    if (abortController.signal.aborted) {
      return;
    }

    console.error("Fetch endpoint request failed", e);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" });
    }
    if (!res.writableEnded && !res.destroyed) {
      res.end("Fetch endpoint request failed");
    }
  } finally {
    req.off("close", abort);
    res.off("close", abort);
  }
}

export function startFetchEndpoint(input: {
  port: number;
  services: ComponentDefinition[];
  identityKeys?: string[];
}) {
  const fetchHandler = restateFetch.createEndpointHandler({
    services: input.services,
    identityKeys: input.identityKeys,
    bidirectional: true,
  });
  const server = http2.createServer((req, res) => {
    void handleFetchRequest(fetchHandler, input.port, req, res);
  });

  server.listen(input.port, "0.0.0.0", () => {
    console.log(`Fetch endpoint listening on 0.0.0.0:${input.port}`);
  });
}
