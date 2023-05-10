"use strict";

import { rlog } from "../utils/logger";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "../generated/proto/discovery";
import { BaseRestateServer, ServiceOpts } from "./base_restate_server";
import { DurableExecutionStateMachine } from "../state_machine";
import { LambdaConnection } from "../connection/lambda_connection";

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

  private async handleRequest(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const pathSegments = event.path.split("/");

    // API Gateway can add a prefix to the path based on the name of the Lambda function and deployment stage
    // (e.g. /default)
    // So we only check the ending of the path on correctness.
    // Logic:
    // 1. Check whether there are at least three segments in the path and whether the third-last one is "invoke".
    // If that is the case, treat it as an invocation.
    // 2. See if the last one is "discover", answer with discovery.
    // 3. Else report "invalid path".
    if (
      pathSegments.length >= 3 &&
      pathSegments[pathSegments.length - 3] === "invoke"
    ) {
      const url = "/" + pathSegments.slice(-3).join("/");
      return await this.handleInvoke(url, event);
    } else if (pathSegments[pathSegments.length - 1] === "discover") {
      return this.handleDiscovery();
    } else {
      const msg =
        "Invalid path: path doesn't end in /invoke/SvcName/MethodName and also not in /discover: " +
        event.path;
      rlog.error(msg);
      rlog.trace();
      return this.toErrorResponse(500, msg);
    }
  }

  // override needed to type the return value to the more concrete LambdaRestateServer type
  public bindService(serviceOpts: ServiceOpts): LambdaRestateServer {
    super.bindService(serviceOpts);
    return this;
  }

  private async handleInvoke(
    url: string,
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const method = this.methodByUrl(url);
    if (event.body == null) {
      const msg = "The incoming message body was null";
      rlog.error(msg);
      rlog.trace();
      return this.toErrorResponse(500, msg);
    }
    const connection = new LambdaConnection(event.body);
    if (method === undefined) {
      if (url.includes("?")) {
        const msg = `Invalid path: path URL seems to include query parameters: ${url}`;
        rlog.error(msg);
        rlog.trace();
        return this.toErrorResponse(500, msg);
      } else {
        const msg = `No service found for URL: ${url}`;
        rlog.error(msg);
        rlog.trace();
        return this.toErrorResponse(404, msg);
      }
    } else {
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
    rlog.info(
      "Answering discovery request. Registering these services: " +
        JSON.stringify(this.discovery.services)
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
