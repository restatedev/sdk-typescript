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

/* eslint-disable @typescript-eslint/ban-types */

import { RestateEndpoint, ServiceBundle } from "../public_api";
import { ServiceDefintion, VirtualObjectDefintion } from "../types/rpc";
import { rlog } from "../logger";
import http2, { Http2ServerRequest, Http2ServerResponse } from "http2";
import { Http2Handler } from "./http2_handler";
import { LambdaHandler } from "./lambda_handler";
import {
  Component,
  ServiceComponent,
  ServiceHandlerFunction,
  VirtualObjectHandlerFunction,
  VritualObjectComponent,
} from "../types/components";

import * as discovery from "../types/discovery";

export class EndpointImpl implements RestateEndpoint {
  private readonly components: Map<string, Component> = new Map();

  public componentByName(componentName: string): Component | undefined {
    return this.components.get(componentName);
  }

  public addComponent(component: Component) {
    this.components.set(component.name(), component);
  }

  public service<P extends string, M>(
    defintion: ServiceDefintion<P, M>
  ): RestateEndpoint {
    const { path, service } = defintion;
    if (!service) {
      throw new TypeError(`no service implemention found.`);
    }
    this.bindServiceComponent(path, service);
    return this;
  }

  public object<P extends string, M>(
    defintion: VirtualObjectDefintion<P, M>
  ): RestateEndpoint {
    const { path, object } = defintion;
    if (!object) {
      throw new TypeError(`no object implemention found.`);
    }
    this.bindVirtualObjectComponent(path, object);
    return this;
  }

  public bind(services: ServiceBundle): RestateEndpoint {
    services.registerServices(this);
    return this;
  }

  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void {
    const handler = new Http2Handler(this);
    return handler.acceptConnection.bind(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any> {
    const handler = new LambdaHandler(this);
    return handler.handleRequest.bind(handler);
  }

  listen(port?: number): Promise<void> {
    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    rlog.info(`Listening on ${actualPort}...`);

    const server = http2.createServer(this.http2Handler());
    server.listen(actualPort);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return new Promise(() => {});
  }

  computeDiscovery(): discovery.Deployment {
    const components = [...this.components.values()].map((c) => c.discovery());

    const deployment: discovery.Deployment = {
      protocolMode: discovery.ProtocolMode.BIDI_STREAM,
      minProtocolVersion: 1,
      maxProtocolVersion: 2,
      components,
    };

    return deployment;
  }

  private bindServiceComponent(name: string, router: RpcRouter) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new ServiceComponent(name);

    for (const [route, handler] of Object.entries(router)) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const fn = handler as ServiceHandlerFunction<any, any>;
      component.add({
        name: route,
        fn: fn.bind(router),
      });
    }

    this.addComponent(component);
  }

  private bindVirtualObjectComponent(name: string, router: RpcRouter) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new VritualObjectComponent(name);

    for (const [route, handler] of Object.entries(router)) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const fn = handler as VirtualObjectHandlerFunction<any, any>;
      component.add({
        name: route,
        fn: fn.bind(router),
      });
    }

    this.addComponent(component);
  }
}

export type RpcRouter = {
  [key: string]: Function;
};
