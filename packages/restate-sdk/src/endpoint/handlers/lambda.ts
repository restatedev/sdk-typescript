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

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { Buffer } from "node:buffer";
import { GenericHandler, RestateRequest } from "./generic";

export class LambdaHandler {
  constructor(private readonly handler: GenericHandler) {}

  async handleRequest(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyStructuredResultV2> {
    //
    // Request path
    //
    const path = "path" in event ? event.path : event.rawPath;

    //
    // Convert the request body to a Uint8Array
    // Lambda functions receive the body as base64 encoded string
    //
    let requestBody: Uint8Array;
    if (!event.body) {
      requestBody = new Uint8Array(0);
    } else if (event.isBase64Encoded) {
      requestBody = Buffer.from(event.body, "base64");
    } else {
      requestBody = Buffer.from(event.body);
    }

    const request: RestateRequest = {
      body: requestBody,
      headers: event.headers,
      url: path,
    };

    const resp = await this.handler.handle(request, {
      AWSRequestId: context.awsRequestId,
    });

    let responseBody;
    if (!resp.body) {
      responseBody = "";
    } else if (event.isBase64Encoded) {
      responseBody = Buffer.from(resp.body).toString("base64");
    } else {
      responseBody = Buffer.from(resp.body).toString("utf8");
    }

    return {
      headers: resp.headers,
      statusCode: resp.statusCode,
      isBase64Encoded: event.isBase64Encoded,
      body: responseBody,
    };
  }
}
