"use strict";

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "./generated/proto/discovery";
import { BaseRestateServer, ServiceOpts } from "./restate";
import { DurableExecutionStateMachine } from "./durable_execution";
import { LambdaConnection } from "./lambda_connection";

export function lambdaApiGatewayHandler(): LambdaRestateServer {
  return new LambdaRestateServer();
}

export class LambdaRestateServer extends BaseRestateServer {
  constructor() {
    super(ProtocolMode.REQUEST_RESPONSE);
  }

  // We use any types to prevent requiring the @types/aws-lambda dependency
  // in the user project.
  // In essence, create() is of type (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(): (event: any) => Promise<any> {
    // return the handler and bind the current context to it, so that it can find the other methods in this class.
    return this.handleRequest.bind(this);
  }

  async handleRequest(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const pathSegments = event.path.split("/");

    // API Gateway can add a prefix to the path based on the name of the Lambda function and deployment stage
    // (e.g. /default)
    // So we only check the ending of the path on correctness.
    // Logic:
    // 1. Check whether there are at least three segments in the path and whether the third-last one is invoke.
    // If that is the case, treat it as an invocation.
    // 2. See of the last one is discover, answer with discovery.
    // 3. Else report invalid path.
    if (
      pathSegments.length >= 3 &&
      pathSegments[pathSegments.length - 3] === "invoke"
    ) {
      const url = "/" + pathSegments.slice(-3).join("/");
      return await this.handleInvoke(url, event);
    } else if (pathSegments[pathSegments.length - 1] === "discover") {
      return this.handleDiscovery();
    } else {
      return this.toErrorResponse(
        500,
        "Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: " +
          event.path
      );
    }
  }

  // override needed to type the return value to the more concrete LambdaRestateServer type
  public bindService({
    descriptor,
    service,
    instance: instance,
  }: ServiceOpts): LambdaRestateServer {
    super.bindService({
      descriptor,
      service,
      instance: instance,
    });
    return this;
  }

  private async handleInvoke(
    url: string,
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const method = this.methodByUrl(url);
    if (event.body == null) {
      return this.toErrorResponse(
        500,
        "ERROR the incoming message body was null"
      );
    }
    const connection = new LambdaConnection(event.body);
    if (method === undefined) {
      if (url.includes("?")) {
        const msg = `ERROR Invalid path: path URL seems to include query parameters: ${url}`;
        console.error(msg);
        return this.toErrorResponse(500, msg);
      } else {
        const msg = `ERROR no service found for URL: ${url}`;
        console.error(msg);
        return this.toErrorResponse(404, msg);
      }
    } else {
      console.info(`INFO new stream for ${url}`);
      new DurableExecutionStateMachine(
        connection,
        method,
        ProtocolMode.REQUEST_RESPONSE
      );
    }

    const result = await connection.getResult();

    return {
      headers: {
        "content-type": "application/restate",
      },
      statusCode: 200,
      isBase64Encoded: true,
      body: result.toString("base64"),
    };
  }

  private handleDiscovery(): APIGatewayProxyResult {
    // return discovery information
    console.debug(
      "DEBUG discovered services at endpoint. Discovery response: " +
        JSON.stringify(this.discovery)
    );
    return {
      headers: {
        "content-type": "application/proto",
      },
      statusCode: 200,
      isBase64Encoded: true,
      body: Buffer.from(
        ServiceDiscoveryResponse.encode(this.discovery).finish()
      ).toString("base64"),
    };
  }

  private toErrorResponse(code: number, message: string) {
    return {
      headers: {
        "content-type": "application/restate",
      },
      statusCode: code,
      isBase64Encoded: true,
      body: Buffer.from(JSON.stringify({ message: message })).toString(
        "base64"
      ),
    };
  }
}
