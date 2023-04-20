"use strict";

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { HostedGrpcServiceMethod } from "./core";
import {
  ProtocolMode,
  ServiceDiscoveryResponse,
} from "./generated/proto/discovery";
import { BaseRestateServer, ServiceOpts } from "./restate";
import { DurableExecutionStateMachine } from "./durable_execution";
import { LambdaConnection } from "./lambda_connection";

export function lambdaHandler(): LambdaRestateServer {
  return new LambdaRestateServer();
}

export class LambdaRestateServer extends BaseRestateServer {
  methods: Record<string, HostedGrpcServiceMethod<unknown, unknown>> = {};
  discovery: ServiceDiscoveryResponse = {
    files: { file: [] },
    services: [],
    minProtocolVersion: 0,
    maxProtocolVersion: 0,
    protocolMode: ProtocolMode.REQUEST_RESPONSE,
  };

  create(): (event: APIGatewayProxyEvent) =>  Promise<APIGatewayProxyResult> {
    // return the handler and bind the current context to it, so that it can find the other methods in this class.
    return this.handleRequest.bind(this);
  }

  async handleRequest(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const pathsegments = event.path.split("/");

    if(pathsegments.length < 3 ){
      throw new Error("Path doesn't match the pattern /invoke/SvcName/MethodName: " + event.path);
    }

    const service = pathsegments[pathsegments.length - 2];
    const methodName = pathsegments[pathsegments.length - 1];
    const url = `/invoke/${service}/${methodName}`;

    console.log("The event: " + JSON.stringify(event))

    // Answer service discovery request
    if (event.path.endsWith("/discover")) {
      // return discovery information
      console.log(JSON.stringify(this.discovery));
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

    const method = this.methodByUrl(url);
    const connection = new LambdaConnection(event.body);
    if (method === undefined) {
      console.log(`INFO no service found for URL ${url}`);
    } else {
      console.log(`INFO new stream for ${url}`);
      new DurableExecutionStateMachine(connection, method);
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
}
