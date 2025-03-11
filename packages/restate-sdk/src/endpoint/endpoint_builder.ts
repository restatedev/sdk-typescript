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

import { HandlerWrapper } from "../types/rpc.js";
import type { Component } from "../types/components.js";
import {
  ServiceComponent,
  VirtualObjectComponent,
  WorkflowComponent,
} from "../types/components.js";

import type * as discovery from "../types/discovery.js";
import { defaultLoggerTransport } from "../logging/console_logger_transport.js";
import {
  type LoggerTransport,
  LogSource,
} from "../logging/logger_transport.js";
import { createLogger } from "../logging/logger.js";

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
};

export class EndpointBuilder {
  private readonly services: Map<string, Component> = new Map();
  public loggerTransport: LoggerTransport = defaultLoggerTransport;

  /**
   * This is a simple console without contextual info.
   *
   * This should be used only in cases where no contextual info is available.
   */
  public rlog = createLogger(this.loggerTransport, LogSource.SYSTEM);

  private _keySet: string[] = [];

  public get keySet(): string[] {
    return this._keySet;
  }

  public componentByName(componentName: string): Component | undefined {
    return this.services.get(componentName);
  }

  public addComponent(component: Component) {
    this.services.set(component.name(), component);
  }

  public bind<P extends string, M>(
    definition:
      | ServiceDefinition<P, M>
      | VirtualObjectDefinition<P, M>
      | WorkflowDefinition<P, M>
  ) {
    if (isServiceDefinition(definition)) {
      const { name, service } = definition;
      if (!service) {
        throw new TypeError(`no service implementation found.`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.bindServiceComponent(name, service, definition as ServiceAuxInfo);
    } else if (isObjectDefinition(definition)) {
      const { name, object } = definition;
      if (!object) {
        throw new TypeError(`no object implementation found.`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.bindVirtualObjectComponent(
        name,
        object,
        definition as ServiceAuxInfo
      );
    } else if (isWorkflowDefinition(definition)) {
      const { name, workflow } = definition;
      if (!workflow) {
        throw new TypeError(`no workflow implementation found.`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.bindWorkflowObjectComponent(
        name,
        workflow,
        definition as ServiceAuxInfo
      );
    } else {
      throw new TypeError(
        "can only bind a service or a virtual object or a workflow definition"
      );
    }
    return this;
  }

  public withIdentityV1(...keys: string[]) {
    this._keySet.push(...keys);
    return this;
  }

  public setLogger(newLogger: LoggerTransport) {
    this.loggerTransport = newLogger;
    this.rlog = createLogger(this.loggerTransport, LogSource.SYSTEM);
    return this;
  }

  computeDiscovery(protocolMode: discovery.ProtocolMode): discovery.Endpoint {
    const services = [...this.services.values()].map((c) => c.discovery());

    const endpoint: discovery.Endpoint = {
      protocolMode,
      minProtocolVersion: 5,
      maxProtocolVersion: 5,
      services,
    };

    return endpoint;
  }

  private bindServiceComponent(
    name: string,
    router: any,
    definition: ServiceAuxInfo
  ) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new ServiceComponent(
      name,
      definition.description,
      definition.metadata
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

    this.addComponent(component);
  }

  private bindVirtualObjectComponent(
    name: string,
    router: any,
    definition: ServiceAuxInfo
  ) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new VirtualObjectComponent(
      name,
      definition.description,
      definition.metadata
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
    this.addComponent(component);
  }

  private bindWorkflowObjectComponent(
    name: string,
    workflow: any,
    definition: ServiceAuxInfo
  ) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new WorkflowComponent(
      name,
      definition.description,
      definition.metadata
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
    this.addComponent(component);
  }
}
