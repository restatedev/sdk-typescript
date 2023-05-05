"use strict";

import { ProtocolMode } from "../generated/proto/discovery";
import { incomingConnectionAtPort } from "../connection/http_connection";
import { DurableExecutionStateMachine } from "../state_machine";
import { BaseRestateServer, ServiceOpts } from "./abstract_restate_server";

export function createServer(): RestateServer {
  return new RestateServer();
}

export class RestateServer extends BaseRestateServer {
  constructor() {
    super(ProtocolMode.BIDI_STREAM);
  }

  public bindService({
    descriptor,
    service,
    instance: instance,
  }: ServiceOpts): RestateServer {
    super.bindService({
      descriptor,
      service,
      instance: instance,
    });
    return this;
  }

  public async listen(port: number | undefined | null) {
    // Infer the port if not specified, or default it
    const actualPort = port ?? parseInt(process.env.PORT ?? "8080");
    console.info(`listening on ${actualPort}...`);

    for await (const connection of incomingConnectionAtPort(
      actualPort,
      this.discovery
    )) {
      const method = this.methodByUrl(connection.url.path);
      if (method === undefined) {
        console.info(`INFO no service found for URL ${connection.url.path}`);
        connection.respond404();
      } else {
        console.info(`INFO new stream for ${connection.url.path}`);
        connection.respondOk();
        new DurableExecutionStateMachine(
          connection,
          method,
          ProtocolMode.BIDI_STREAM
        );
      }
    }
  }
}
