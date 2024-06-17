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
} from "@restatedev/restate-sdk-core";

import { HandlerWrapper } from "../types/rpc.js";
import {
  type Component,
  ServiceComponent,
  VirtualObjectComponent,
  WorkflowComponent,
} from "../types/components.js";

import type * as discovery from "../types/discovery.js";
import { type KeySetV1, parseKeySetV1 } from "./request_signing/v1.js";
import type { WorkflowDefinition } from "@restatedev/restate-sdk-core";

function isServiceDefinition<P extends string, M>(
  m: any
): m is ServiceDefinition<P, M> & { service: M } {
  return m && m.service;
}

function isObjectDefinition<P extends string, M>(
  m: any
): m is VirtualObjectDefinition<P, M> & { object: M } {
  return m && m.object;
}

function isWorkflowDefinition<P extends string, M>(
  m: any
): m is WorkflowDefinition<P, M> & { workflow: M } {
  return m && m.workflow;
}

export class EndpointBuilder {
  private readonly services: Map<string, Component> = new Map();
  private _keySet?: KeySetV1;

  public get keySet(): KeySetV1 | undefined {
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
      this.bindServiceComponent(name, service);
    } else if (isObjectDefinition(definition)) {
      const { name, object } = definition;
      if (!object) {
        throw new TypeError(`no object implementation found.`);
      }
      this.bindVirtualObjectComponent(name, object);
    } else if (isWorkflowDefinition(definition)) {
      const { name, workflow } = definition;
      if (!workflow) {
        throw new TypeError(`no workflow implementation found.`);
      }
      this.bindWorkflowObjectComponent(name, workflow);
    } else {
      throw new TypeError(
        "can only bind a service or a virtual object or a workflow definition"
      );
    }
    return this;
  }

  public withIdentityV1(...keys: string[]) {
    if (!this._keySet) {
      this._keySet = parseKeySetV1(keys);
      return this;
    }
    parseKeySetV1(keys).forEach((buffer, key) =>
      this._keySet?.set(key, buffer)
    );
    return this;
  }

  computeDiscovery(protocolMode: discovery.ProtocolMode): discovery.Endpoint {
    const services = [...this.services.values()].map((c) => c.discovery());

    const endpoint: discovery.Endpoint = {
      protocolMode,
      minProtocolVersion: 1,
      maxProtocolVersion: 2,
      services,
    };

    return endpoint;
  }

  private bindServiceComponent(name: string, router: any) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new ServiceComponent(name);

    for (const [route, handler] of Object.entries(router)) {
      const wrapper = HandlerWrapper.fromHandler(handler);
      if (!wrapper) {
        throw new TypeError(`${route} is not a restate handler.`);
      }
      wrapper.bindInstance(router);
      component.add(route, wrapper);
    }

    this.addComponent(component);
  }

  private bindVirtualObjectComponent(name: string, router: any) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new VirtualObjectComponent(name);

    for (const [route, handler] of Object.entries(router)) {
      const wrapper = HandlerWrapper.fromHandler(handler);
      if (!wrapper) {
        throw new TypeError(`${route} is not a restate handler.`);
      }
      wrapper.bindInstance(router);
      component.add(route, wrapper);
    }
    this.addComponent(component);
  }

  private bindWorkflowObjectComponent(name: string, workflow: any) {
    if (name.indexOf("/") !== -1) {
      throw new Error("service name must not contain any slash '/'");
    }
    const component = new WorkflowComponent(name);

    for (const [route, handler] of Object.entries(workflow)) {
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
