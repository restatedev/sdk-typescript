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
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RestateEndpoint, ServiceBundle } from "../public_api";
import { ServiceDefinition, VirtualObjectDefinition } from "../types/rpc";
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
import { KeySetV1, parseKeySetV1 } from "./request_signing/v1";

function isServiceDefinition<P extends string, M>(
  m: any
): m is ServiceDefinition<P, M> {
  return m && m.service;
}

function isObjectDefinition<P extends string, M>(
  m: any
): m is VirtualObjectDefinition<P, M> {
  return m && m.object;
}

export const endpointImpl = (): RestateEndpoint => new EndpointImpl();

export class EndpointImpl implements RestateEndpoint {
  private readonly components: Map<string, Component> = new Map();
  private _keySet?: KeySetV1;

  public get keySet(): KeySetV1 | undefined {
    return this._keySet;
  }

  public componentByName(componentName: string): Component | undefined {
    return this.components.get(componentName);
  }

  public addComponent(component: Component) {
    this.components.set(component.name(), component);
  }

  public bindBundle(services: ServiceBundle): RestateEndpoint {
    services.registerServices(this);
    return this;
  }

  public bind<P extends string, M>(
    definition: ServiceDefinition<P, M> | VirtualObjectDefinition<P, M>
  ): RestateEndpoint {
    if (isServiceDefinition(definition)) {
      const { name, service } = definition;
      if (!service) {
        throw new TypeError(`no service implemention found.`);
      }
      this.bindServiceComponent(name, service);
    } else if (isObjectDefinition(definition)) {
      const { name, object } = definition;
      if (!object) {
        throw new TypeError(`no object implemention found.`);
      }
      this.bindVirtualObjectComponent(name, object);
    } else {
      throw new TypeError(
        "can only bind a service or a virtual object definition"
      );
    }
    return this;
  }

  public withIdentityV1(...keys: string[]): RestateEndpoint {
    if (!this._keySet) {
      this._keySet = parseKeySetV1(keys);
      return this;
    }
    parseKeySetV1(keys).forEach((buffer, key) =>
      this._keySet?.set(key, buffer)
    );
    return this;
  }

  http2Handler(): (
    request: Http2ServerRequest,
    response: Http2ServerResponse
  ) => void {
    if (!this._keySet) {
      if (globalThis.process.env.NODE_ENV == "production") {
        rlog.warn(
          `Accepting HTTP requests without validating request signatures; endpoint access must be restricted`
        );
      }
    } else {
      rlog.info(
        `Validating HTTP requests using signing keys [${Array.from(
          this._keySet.keys()
        )}]`
      );
    }
    const handler = new Http2Handler(this);
    return handler.acceptConnection.bind(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lambdaHandler(): (event: any, ctx: any) => Promise<any> {
    if (!this._keySet) {
      rlog.warn(
        `Accepting Lambda requests without validating request signatures; Invoke permissions must be restricted`
      );
    } else {
      rlog.info(
        `Validating Lambda requests using signing keys [${Array.from(
          this._keySet.keys()
        )}]`
      );
    }
    const handler = new LambdaHandler(this);
    return handler.handleRequest.bind(handler);
  }

  listen(port?: number): Promise<number> {
    const actualPort = port ?? parseInt(process.env.PORT ?? "9080");
    rlog.info(`Listening on ${actualPort}...`);

    const server = http2.createServer(this.http2Handler());

    return new Promise((resolve, reject) => {
      let failed = false;
      server.once("error", (e) => {
        failed = true;
        reject(e);
      });
      server.listen(actualPort, () => {
        if (failed) {
          return;
        }
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(
            new TypeError(
              "endpoint.listen() currently supports only binding to a PORT"
            )
          );
        } else {
          resolve(address.port);
        }
      });
    });
  }

  computeDiscovery(protocolMode: discovery.ProtocolMode): discovery.Deployment {
    const components = [...this.components.values()].map((c) => c.discovery());

    const deployment: discovery.Deployment = {
      protocolMode,
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
