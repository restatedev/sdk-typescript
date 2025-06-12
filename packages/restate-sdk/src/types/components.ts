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
import type {
  HandlerWrapper,
  ObjectOptions,
  ServiceOptions,
  WorkflowOptions,
} from "./rpc.js";
import { HandlerKind } from "./rpc.js";
import { millisOrDurationToMillis } from "@restatedev/restate-sdk-core";

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
    public readonly metadata?: Record<string, string>,
    public readonly options?: ServiceOptions
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, handlerWrapper: HandlerWrapper) {
    this.handlers.set(name, new ServiceHandler(name, handlerWrapper, this));
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          ...commonHandlerOptions(handler.handlerWrapper),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "SERVICE",
      handlers,
      documentation: this.description,
      metadata: this.metadata,
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }
}

export class ServiceHandler implements ComponentHandler {
  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: ServiceComponent
  ) {}

  name(): string {
    return this.handlerName;
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

//
// Virtual Object
//

export class VirtualObjectComponent implements Component {
  private readonly handlers: Map<string, VirtualObjectHandler> = new Map();

  constructor(
    public readonly componentName: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>,
    public readonly options?: ObjectOptions
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, wrapper: HandlerWrapper) {
    this.handlers.set(name, new VirtualObjectHandler(name, wrapper, this));
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          ty: handler.kind() === HandlerKind.EXCLUSIVE ? "EXCLUSIVE" : "SHARED",
          ...commonHandlerOptions(handler.handlerWrapper),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "VIRTUAL_OBJECT",
      handlers,
      documentation: this.description,
      metadata: this.metadata,
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }
}

export class VirtualObjectHandler implements ComponentHandler {
  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: VirtualObjectComponent
  ) {}

  name(): string {
    return this.handlerName;
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
  private readonly handlers: Map<string, WorkflowHandler> = new Map();

  constructor(
    public readonly componentName: string,
    public readonly description?: string,
    public readonly metadata?: Record<string, string>,
    public readonly options?: WorkflowOptions
  ) {}

  name(): string {
    return this.componentName;
  }

  add(name: string, wrapper: HandlerWrapper) {
    this.handlers.set(name, new WorkflowHandler(name, wrapper, this));
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          ty: handler.kind() === HandlerKind.WORKFLOW ? "WORKFLOW" : "SHARED",
          workflowCompletionRetention:
            handler.kind() === HandlerKind.WORKFLOW &&
            this.options?.workflowRetention !== undefined
              ? millisOrDurationToMillis(this.options?.workflowRetention)
              : undefined,
          ...commonHandlerOptions(handler.handlerWrapper),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "WORKFLOW",
      handlers,
      documentation: this.description,
      metadata: this.metadata,
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }
}

export class WorkflowHandler implements ComponentHandler {
  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: WorkflowComponent
  ) {}

  name(): string {
    return this.handlerName;
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

function commonServiceOptions(
  options?: ServiceOptions | ObjectOptions | WorkflowOptions
) {
  return {
    journalRetention:
      options?.journalRetention !== undefined
        ? millisOrDurationToMillis(options.journalRetention)
        : undefined,
    idempotencyRetention:
      options?.idempotencyRetention !== undefined
        ? millisOrDurationToMillis(options.idempotencyRetention)
        : undefined,
    inactivityTimeout:
      options?.inactivityTimeout !== undefined
        ? millisOrDurationToMillis(options.inactivityTimeout)
        : undefined,
    abortTimeout:
      options?.abortTimeout !== undefined
        ? millisOrDurationToMillis(options.abortTimeout)
        : undefined,
    ingressPrivate: options?.ingressPrivate,
    enableLazyState:
      options !== undefined && "enableLazyState" in options
        ? options.enableLazyState
        : undefined,
  };
}

function commonHandlerOptions(wrapper: HandlerWrapper) {
  return {
    input: handlerInputDiscovery(wrapper),
    output: handlerOutputDiscovery(wrapper),
    journalRetention:
      wrapper.journalRetention !== undefined
        ? millisOrDurationToMillis(wrapper.journalRetention)
        : undefined,
    idempotencyRetention:
      wrapper.idempotencyRetention !== undefined
        ? millisOrDurationToMillis(wrapper.idempotencyRetention)
        : undefined,
    inactivityTimeout:
      wrapper.inactivityTimeout !== undefined
        ? millisOrDurationToMillis(wrapper.inactivityTimeout)
        : undefined,
    abortTimeout:
      wrapper.abortTimeout !== undefined
        ? millisOrDurationToMillis(wrapper.abortTimeout)
        : undefined,
    ingressPrivate: wrapper.ingressPrivate,
    enableLazyState: wrapper.enableLazyState,
    documentation: wrapper.description,
    metadata: wrapper.metadata,
  };
}
