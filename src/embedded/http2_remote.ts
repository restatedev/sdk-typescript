/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import http2 from "node:http2";
import { once } from "events";
import {
  RemoteContext,
  RemoteContextClientImpl,
} from "../generated/proto/services";

export class RequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText?: string
  ) {
    super(`${status} ${statusText ?? ""}`);
  }

  precondtionFailed(): boolean {
    return this.status === http2.constants.HTTP_STATUS_PRECONDITION_FAILED;
  }
}

export const bufConnectRemoteContext = (url: string): RemoteContext => {
  const httpClient = new ProtobufHttp2Client(url);

  return new RemoteContextClientImpl({
    request: (service: string, method: string, data: Uint8Array) =>
      httpClient.post(`/${service}/${method}`, data),
  });
};

class ProtobufHttp2Client {
  private session?: http2.ClientHttp2Session;

  public constructor(private readonly ingress: string) {}

  private async client(): Promise<http2.ClientHttp2Session> {
    if (this.session !== undefined) {
      return this.session;
    }
    const client = http2.connect(this.ingress);
    client.unref();

    client.once("goaway", () => {
      this.session = undefined;
    });
    client.once("close", () => {
      this.session = undefined;
    });
    this.session = client;
    return client;
  }

  public async post(path: string, body: Uint8Array): Promise<Uint8Array> {
    const client = await this.client();

    const req = client.request({
      [http2.constants.HTTP2_HEADER_SCHEME]: "http",
      [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_POST,
      [http2.constants.HTTP2_HEADER_PATH]: path,
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/proto",
      [http2.constants.HTTP2_HEADER_CONTENT_LENGTH]: body.length,
    });
    req.end(body);

    const [headers] = await once(req, "response");
    const status = headers[http2.constants.HTTP2_HEADER_STATUS] ?? 0;
    if (status !== 200) {
      throw new RequestError(path, status);
    }
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
