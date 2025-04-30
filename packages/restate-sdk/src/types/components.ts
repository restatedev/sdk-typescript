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

import * as d from "./discovery.js";
import type { ContextImpl } from "../context_impl.js";
import type { HandlerWrapper } from "./rpc.js";
import { HandlerKind } from "./rpc.js";

//
// Interfaces
//
export interface Component {
  name(): string;
  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined;
  discovery(): d.Service;
}

export interface ComponentHandler {
  name(): string;
  component(): Component;
  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array>;
  kind(): HandlerKind;
}

//
// Service
//

function handlerInputDiscovery(handler: HandlerWrapper): d.InputPayload {
  let contentType = undefined;
  let jsonSchema = undefined;

  if (handler.inputSerde.jsonSchema) {
    jsonSchema = handler.inputSerde.jsonSchema;
    contentType =
      handler.accept ?? handler.inputSerde.contentType ?? "application/json";
  } else if (handler.accept) {
    contentType = handler.accept;
  } else if (handler.inputSerde.contentType) {
    contentType = handler.inputSerde.contentType;
  } else {
    // no input information
    return {};
  }

  return {
    required: false,
    contentType,
    jsonSchema,
  };
}

function handlerOutputDiscovery(handler: HandlerWrapper): d.OutputPayload {
  let contentType = undefined;
  let jsonSchema = undefined;

  if (handler.outputSerde.jsonSchema) {
    jsonSchema = handler.outputSerde.jsonSchema;
    contentType =
      handler.contentType ??
      handler.outputSerde.contentType ??
      "application/json";
  } else if (handler.contentType) {
    contentType = handler.contentType;
  } else if (handler.outputSerde.contentType) {
    contentType = handler.outputSerde.contentType;
  } else {
    // no input information
    return { setContentTypeIfEmpty: false };
  }

  return {
    setContentTypeIfEmpty: false,
    jsonSchema,
    contentType,
  };
}

export class ServiceComponent implements Component {
  private readonly handlers: Map<string, ServiceHandler> = new Map();

  constructor(
    private readonly componentName: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, handlerWrapper: HandlerWrapper) {
    const serviceHandler = new ServiceHandler(name, handlerWrapper, this);
    this.handlers.set(name, serviceHandler);
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, serviceHandler]) => {
        return {
          name,
          input: handlerInputDiscovery(serviceHandler.handlerWrapper),
          output: handlerOutputDiscovery(serviceHandler.handlerWrapper),
          documentation: serviceHandler.handlerWrapper.description,
          metadata: serviceHandler.handlerWrapper.metadata,
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: d.ServiceType.SERVICE,
      handlers,
      documentations: this.description,
      metadata: this.metadata,
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }
}

export class ServiceHandler implements ComponentHandler {
  private readonly handlerName: string;
  private readonly parent: ServiceComponent;
  public readonly handlerWrapper: HandlerWrapper;

  constructor(
    name: string,
    handlerWrapper: HandlerWrapper,
    parent: ServiceComponent
  ) {
    this.handlerName = name;
    this.parent = parent;
    this.handlerWrapper = handlerWrapper;
  }

  kind(): HandlerKind {
    return this.handlerWrapper.kind;
  }

  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array> {
    return this.handlerWrapper.invoke(context, input);
  }

  name(): string {
    return this.handlerName;
  }

  component(): Component {
    return this.parent;
  }
}

//
// Virtual Object
//

export class VirtualObjectComponent implements Component {
  private readonly handlers: Map<string, HandlerWrapper> = new Map();

  constructor(
    public readonly componentName: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, wrapper: HandlerWrapper) {
    this.handlers.set(name, wrapper);
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, opts]) => {
        return {
          name,
          input: handlerInputDiscovery(opts),
          output: handlerOutputDiscovery(opts),
          ty:
            opts.kind === HandlerKind.EXCLUSIVE
              ? d.ServiceHandlerType.EXCLUSIVE
              : d.ServiceHandlerType.SHARED,

          documentation: opts.description,
          metadata: opts.metadata,
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: d.ServiceType.VIRTUAL_OBJECT,
      handlers,
      documentations: this.description,
      metadata: this.metadata,
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    const wrapper = this.handlers.get(url.handlerName);
    if (!wrapper) {
      return undefined;
    }
    return new VirtualObjectHandler(url.handlerName, this, wrapper);
  }
}

export class VirtualObjectHandler implements ComponentHandler {
  constructor(
    private readonly componentName: string,
    private readonly parent: VirtualObjectComponent,
    private readonly handlerWrapper: HandlerWrapper
  ) {}

  name(): string {
    return this.componentName;
  }
  component(): Component {
    return this.parent;
  }

  kind(): HandlerKind {
    return this.handlerWrapper.kind;
  }

  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array> {
    return this.handlerWrapper.invoke(context, input);
  }
}

// Workflow

export class WorkflowComponent implements Component {
  private readonly handlers: Map<string, HandlerWrapper> = new Map();

  constructor(
    public readonly componentName: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, wrapper: HandlerWrapper) {
    this.handlers.set(name, wrapper);
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          input: handlerInputDiscovery(handler),
          output: handlerOutputDiscovery(handler),
          ty:
            handler.kind === HandlerKind.WORKFLOW
              ? d.ServiceHandlerType.WORKFLOW
              : d.ServiceHandlerType.SHARED,

          documentation: handler.description,
          metadata: handler.metadata,
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: d.ServiceType.WORKFLOW,
      handlers,
      documentations: this.description,
      metadata: this.metadata,
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    const wrapper = this.handlers.get(url.handlerName);
    if (!wrapper) {
      return undefined;
    }
    return new WorkflowHandler(url.handlerName, this, wrapper);
  }
}

export class WorkflowHandler implements ComponentHandler {
  constructor(
    private readonly componentName: string,
    private readonly parent: WorkflowComponent,
    private readonly handlerWrapper: HandlerWrapper
  ) {}

  name(): string {
    return this.componentName;
  }
  component(): Component {
    return this.parent;
  }

  kind(): HandlerKind {
    return this.handlerWrapper.kind;
  }

  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array> {
    return this.handlerWrapper.invoke(context, input);
  }
}

export type PathComponents =
  | InvokePathComponents
  | { type: "discover" }
  | { type: "health" }
  | { type: "unknown"; path: string };

export type InvokePathComponents = {
  type: "invoke";
  componentName: string;
  handlerName: string;
};

export function parseUrlComponents(urlPath?: string): PathComponents {
  if (!urlPath) {
    return { type: "unknown", path: "" };
  }
  const fragments = urlPath.split("/");
  if (fragments.length >= 3 && fragments[fragments.length - 3] === "invoke") {
    return {
      type: "invoke",
      componentName: fragments[fragments.length - 2],
      handlerName: fragments[fragments.length - 1],
    };
  }
  if (fragments.length > 0 && fragments[fragments.length - 1] === "discover") {
    return { type: "discover" };
  }
  if (fragments.length > 0 && fragments[fragments.length - 1] === "health") {
    return { type: "health" };
  }
  return { type: "unknown", path: urlPath };
}
