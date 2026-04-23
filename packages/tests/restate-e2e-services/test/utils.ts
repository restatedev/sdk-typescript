// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as http2 from "node:http2";
import * as restate from "@restatedev/restate-sdk-clients";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export function getIngressUrl(): string {
  const url = process.env.RESTATE_INGRESS_URL;
  if (!url) {
    throw new Error("RESTATE_INGRESS_URL environment variable is not set");
  }
  return url.replace(/\/+$/, "");
}

export function getAdminUrl(): string {
  const url = process.env.RESTATE_ADMIN_URL;
  if (!url) {
    throw new Error("RESTATE_ADMIN_URL environment variable is not set");
  }
  return url.replace(/\/+$/, "");
}

export function getServiceUrl(): string {
  const url = process.env.RESTATE_SERVICE_URL ?? "http://localhost:9080";
  return url.replace(/\/+$/, "");
}

export function ingressClient() {
  return restate.connect({ url: getIngressUrl() });
}

function responseHeaders(headers: http2.IncomingHttpHeaders): Headers {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":") || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        responseHeaders.append(key, entry);
      }
    } else {
      responseHeaders.set(key, String(value));
    }
  }
  return responseHeaders;
}

function requestHeaders(
  headers: HeadersInit | undefined
): http2.OutgoingHttpHeaders {
  if (headers === undefined) {
    return {};
  }

  const requestHeaders: http2.OutgoingHttpHeaders = {};
  for (const [key, value] of new Headers(headers).entries()) {
    requestHeaders[key] = value;
  }
  return requestHeaders;
}

async function requestBody(
  body: BodyInit | null | undefined
): Promise<Buffer | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString());
  }
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new TypeError(`Unsupported request body type: ${typeof body}`);
}

export const fetchH2: FetchLike = async (
  input: string | URL,
  init?: RequestInit
): Promise<Response> => {
  const url =
    typeof input === "string" ? new URL(input) : new URL(input.toString());
  const session = http2.connect(url.origin);

  return await new Promise<Response>(async (resolve, reject) => {
    let settled = false;
    let headers: http2.IncomingHttpHeaders = {};
    const chunks: Buffer[] = [];

    const settle = (cb: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cb();
    };

    const closeSession = () => {
      if (!session.closed && !session.destroyed) {
        session.close();
      }
    };

    session.once("error", (error) => {
      settle(() => reject(error));
    });

    const req = session.request({
      ":method": init?.method ?? "GET",
      ":path": `${url.pathname}${url.search}`,
      ...requestHeaders(init?.headers),
    });

    req.once("response", (incomingHeaders) => {
      headers = incomingHeaders;
    });
    req.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    req.once("error", (error) => {
      settle(() => {
        closeSession();
        reject(error);
      });
    });
    req.once("end", () => {
      settle(() => {
        closeSession();
        resolve(
          new Response(Buffer.concat(chunks), {
            status: Number(headers[":status"] ?? 500),
            headers: responseHeaders(headers),
          })
        );
      });
    });

    try {
      const body = await requestBody(init?.body);
      if (body) {
        req.end(body);
      } else {
        req.end();
      }
    } catch (error) {
      settle(() => {
        req.close();
        closeSession();
        reject(error);
      });
    }
  });
};
