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

import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk-core";

import type {
  ObjectOptions,
  ServiceOptions,
  WorkflowOptions,
} from "../types/rpc.js";
import { HandlerWrapper } from "../types/rpc.js";
import type { Component } from "./components.js";
import {
  ServiceComponent,
  VirtualObjectComponent,
  WorkflowComponent,
} from "./components.js";
import type * as discovery from "./discovery.js";
import { defaultLoggerTransport } from "../logging/console_logger_transport.js";
import {
  type LoggerTransport,
  LogSource,
} from "../logging/logger_transport.js";
import type { Logger } from "../logging/logger.js";
import { createLogger } from "../logging/logger.js";
import type { DefaultServiceOptions } from "../endpoint.js";

function isServiceDefinition<P extends string, M>(
  m: Record<string, any>
): m is ServiceDefinition<P, M> & { service: M } {
  return m && m.service !== undefined;
}

function isObjectDefinition<P extends string, M>(
  m: Record<string, any>
): m is VirtualObjectDefinition<P, M> & { object: M } {
  return m && m.object !== undefined;
}

function isWorkflowDefinition<P extends string, M>(
  m: Record<string, any>
): m is WorkflowDefinition<P, M> & { workflow: M } {
  return m && m.workflow !== undefined;
}

/**
 * Services can have additional information that is not part of the definition.
 * For example a description or metadata.
 */
type ServiceAuxInfo = {
  description?: string;
  metadata?: Record<string, any>;
  options?: ServiceOptions | ObjectOptions | WorkflowOptions;
};

export type Endpoint = {
  loggerTransport: LoggerTransport;
  components: Map<string, Component>;
  keySet: string[];
  /**
   * This is a simple console without contextual info.
   *
   * This should be used only in cases where no contextual info is available.
   */
  rlog: Logger;
  /**
   * All discovery metadata, except protocol mode provided by the node/fetch/lambda endpoint implementations
   */
  discoveryMetadata: Omit<discovery.Endpoint, "protocolMode">;
};

export class EndpointBuilder {
  private readonly serviceDefinitions: Map<
    string,
    | ServiceDefinition<string, any>
    | VirtualObjectDefinition<string, any>
    | WorkflowDefinition<string, any>
  > = new Map();
  private loggerTransport: LoggerTransport = defaultLoggerTransport;
  private keySet: string[] = [];
  private defaultServiceOptions: DefaultServiceOptions = {};

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ) {
    // Validate service name
    if (definition.name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }

    this.serviceDefinitions.set(definition.name, definition);
  }

  public addIdentityKeys(...keys: string[]) {
    this.keySet.push(...keys);
  }

  public setDefaultServiceOptions(options: DefaultServiceOptions) {
    this.defaultServiceOptions = options;
  }

  public setLogger(newLogger: LoggerTransport) {
    this.loggerTransport = newLogger;
  }

  public build(): Endpoint {
    const rlog = createLogger(this.loggerTransport, LogSource.SYSTEM);

    // Build the components
    const components = new Map<string, Component>();
    for (const [name, definition] of this.serviceDefinitions) {
      if (isServiceDefinition(definition)) {
        const { name, service } = definition;
        if (!service) {
          throw new TypeError(`no service implementation found.`);
        }
        components.set(
          name,
          buildServiceComponent(
            name,
            service,
            definition as ServiceAuxInfo,
            this.defaultServiceOptions
          )
        );
      } else if (isObjectDefinition(definition)) {
        const { name, object } = definition;
        if (!object) {
          throw new TypeError(`no object implementation found.`);
        }
        components.set(
          name,
          buildVirtualObjectComponent(
            name,
            object,
            definition as ServiceAuxInfo,
            this.defaultServiceOptions
          )
        );
      } else if (isWorkflowDefinition(definition)) {
        const { name, workflow } = definition;
        if (!workflow) {
          throw new TypeError(`no workflow implementation found.`);
        }
        components.set(
          name,
          buildWorkflowComponent(
            name,
            workflow,
            definition as ServiceAuxInfo,
            this.defaultServiceOptions
          )
        );
      } else {
        throw new TypeError(
          `cannot bind ${name}, can only bind a service or a virtual object or a workflow definition`
        );
      }
    }

    // Compute discovery metadata
    const discoveryMetadata = computeDiscovery(components);

    return {
      keySet: this.keySet,
      loggerTransport: this.loggerTransport,
      rlog,
      components,
      discoveryMetadata,
    };
  }
}

function computeDiscovery(
  components: Map<string, Component>
): discovery.Endpoint {
  return {
    minProtocolVersion: 5,
    maxProtocolVersion: 5,
    services: [...components.values()].map((c) => c.discovery()),
  };
}

function buildServiceComponent(
  name: string,
  router: any,
  definition: ServiceAuxInfo,
  defaultServiceOptions: DefaultServiceOptions
): ServiceComponent {
  if (name.indexOf("/") !== -1) {
    throw new Error("service name must not contain any slash '/'");
  }
  const component = new ServiceComponent(
    name,
    definition.description,
    definition.metadata,
    {
      ...defaultServiceOptions,
      ...(definition?.options as ServiceOptions),
    }
  );

  for (const [route, handler] of Object.entries(
    router as { [s: string]: any }
  )) {
    const wrapper = HandlerWrapper.fromHandler(handler);
    if (!wrapper) {
      throw new TypeError(`${route} is not a restate handler.`);
    }
    wrapper.bindInstance(router);
    component.add(route, wrapper);
  }

  return component;
}

function buildVirtualObjectComponent(
  name: string,
  router: any,
  definition: ServiceAuxInfo,
  defaultServiceOptions: DefaultServiceOptions
): VirtualObjectComponent {
  if (name.indexOf("/") !== -1) {
    throw new Error("service name must not contain any slash '/'");
  }
  const component = new VirtualObjectComponent(
    name,
    definition.description,
    definition.metadata,
    {
      ...defaultServiceOptions,
      ...(definition?.options as ObjectOptions),
    }
  );

  for (const [route, handler] of Object.entries(
    router as { [s: string]: any }
  )) {
    const wrapper = HandlerWrapper.fromHandler(handler);
    if (!wrapper) {
      throw new TypeError(`${route} is not a restate handler.`);
    }
    wrapper.bindInstance(router);
    component.add(route, wrapper);
  }
  return component;
}

function buildWorkflowComponent(
  name: string,
  workflow: any,
  definition: ServiceAuxInfo,
  defaultServiceOptions: DefaultServiceOptions
): WorkflowComponent {
  if (name.indexOf("/") !== -1) {
    throw new Error("service name must not contain any slash '/'");
  }
  const component = new WorkflowComponent(
    name,
    definition.description,
    definition.metadata,
    {
      ...defaultServiceOptions,
      ...(definition?.options as WorkflowOptions),
    }
  );

  for (const [route, handler] of Object.entries(
    workflow as { [s: string]: any }
  )) {
    const wrapper = HandlerWrapper.fromHandler(handler);
    if (!wrapper) {
      throw new TypeError(`${route} is not a restate handler.`);
    }
    wrapper.bindInstance(workflow);
    component.add(route, wrapper);
  }
  return component;
}
