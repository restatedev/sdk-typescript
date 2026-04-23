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

import type { Serde } from "@restatedev/restate-sdk-core";
import type { Endpoint } from "../endpoint.js";
import type { PreviewPathComponents } from "../components.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { ensureError } from "../../types/errors.js";
import type {
  InputReader,
  OutputWriter,
  ResponseHeaders,
  RestateResponse,
} from "./types.js";
import { errorResponse } from "./utils.js";

export function handlePreview(
  endpoint: Endpoint,
  previewPathComponent: PreviewPathComponents
): RestateResponse {
  const service = endpoint.components.get(previewPathComponent.componentName);
  if (!service) {
    const msg = `No service found for name: ${previewPathComponent.componentName}`;
    endpoint.rlog.error(msg);
    return errorResponse(404, msg);
  }

  const resolvedSerde = service.serdeMatching(previewPathComponent.serdeName);
  if (!resolvedSerde?.preview) {
    const msg = `No previewable serde found for URL: ${JSON.stringify(previewPathComponent)}`;
    endpoint.rlog.error(msg);
    return errorResponse(404, msg);
  }

  return new RestatePreviewResponse(
    resolvedSerde,
    previewPathComponent.operation
  );
}

type PreviewResponse = {
  body: Uint8Array;
  headers: ResponseHeaders;
  statusCode: number;
};

class RestatePreviewResponse implements RestateResponse {
  constructor(
    private readonly serde: Serde<unknown>,
    private readonly operation: "decode" | "encode"
  ) {}

  async process({
    inputReader,
    outputWriter,
    writeHead,
  }: {
    inputReader: InputReader;
    outputWriter: OutputWriter;
    writeHead: (statusCode: number, headers: ResponseHeaders) => void;
    abortSignal: AbortSignal;
  }): Promise<void> {
    const response = await this.computeResponse(inputReader);

    writeHead(response.statusCode, response.headers);
    try {
      await outputWriter.write(response.body);
    } finally {
      await outputWriter.close();
    }
  }

  private async computeResponse(
    inputReader: InputReader
  ): Promise<PreviewResponse> {
    try {
      const body = await readAllInput(inputReader);
      return this.operation === "decode"
        ? await this.decode(body)
        : await this.encode(body);
    } catch (e) {
      return previewErrorResponse(ensureError(e).message);
    }
  }

  private async decode(requestBody: Uint8Array): Promise<PreviewResponse> {
    const value = this.serde.deserialize(requestBody);
    const json = await this.serde.preview!.toJsonString(value);
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "x-restate-server": X_RESTATE_SERVER,
      },
      body: new TextEncoder().encode(json),
    };
  }

  private async encode(requestBody: Uint8Array): Promise<PreviewResponse> {
    const json = new TextDecoder().decode(requestBody);
    const value = await this.serde.preview!.fromJsonString(json);
    return {
      statusCode: 200,
      headers: {
        "content-type": this.serde.contentType ?? "application/octet-stream",
        "x-restate-server": X_RESTATE_SERVER,
      },
      body: this.serde.serialize(value),
    };
  }
}

function previewErrorResponse(message: string): PreviewResponse {
  return {
    statusCode: 422,
    headers: {
      "content-type": "application/json",
      "x-restate-server": X_RESTATE_SERVER,
    },
    body: new TextEncoder().encode(JSON.stringify({ message })),
  };
}

async function readAllInput(inputReader: InputReader): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const chunk = await inputReader.next();
    if (chunk.done) {
      break;
    }
    chunks.push(chunk.value);
    totalLength += chunk.value.length;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}
