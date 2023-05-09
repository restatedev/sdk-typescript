"use strict";

import { ProtocolMode } from "../generated/proto/discovery";
import { incomingConnectionAtPort } from "../connection/http_connection";
import { DurableExecutionStateMachine } from "../state_machine";
import { BaseRestateServer, ServiceOpts } from "./base_restate_server";
import { rlog } from "../utils/logger";

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

  public async listen(port?: number) {
    // Infer the port if not specified, or default it
    const actualPort = port ?? parseInt(process.env.PORT ?? "8080");
    rlog.info(`Listening on ${actualPort}...`);

    for await (const connection of incomingConnectionAtPort(
      actualPort,
      this.discovery
    )) {
      const method = this.methodByUrl(connection.url.path);
      if (method === undefined) {
        rlog.error(`No service found for URL ${connection.url.path}`);
        rlog.trace();
        // Respons 404 and end the stream.
        connection.respond404();
      } else {
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
