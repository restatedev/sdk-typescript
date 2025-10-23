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

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as d from "./discovery.js";
import type { ContextImpl } from "../context_impl.js";
import type {
  HandlerWrapper,
  ObjectOptions,
  ServiceOptions,
  WorkflowOptions,
} from "../types/rpc.js";
import { HandlerKind } from "../types/rpc.js";
import type { Serde } from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis, serde } from "@restatedev/restate-sdk-core";

//
// Interfaces
//
export interface Component {
  name(): string;
  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined;
  discovery(): d.Service;
  options?: ServiceOptions | ObjectOptions | WorkflowOptions;
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

function handlerInputDiscovery(
  handler: HandlerWrapper,
  defaultSerde: Serde<any>
): d.InputPayload {
  const serde = handler.inputSerde ?? defaultSerde;

  let contentType = undefined;
  let jsonSchema = undefined;

  if (serde.jsonSchema) {
    jsonSchema = serde.jsonSchema;
    contentType = handler.accept ?? serde.contentType;
  } else if (handler.accept) {
    contentType = handler.accept;
  } else if (serde.contentType) {
    contentType = serde.contentType;
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

function handlerOutputDiscovery(
  handler: HandlerWrapper,
  defaultSerde: Serde<any>
): d.OutputPayload {
  const serde = handler.outputSerde ?? defaultSerde;

  let contentType = undefined;
  let jsonSchema = undefined;

  if (serde.jsonSchema) {
    jsonSchema = serde.jsonSchema;
    contentType = serde.contentType ?? "application/json";
  } else if (serde.contentType) {
    contentType = serde.contentType;
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
          ...commonHandlerOptions(
            handler.handlerWrapper,
            this.options?.serde ?? serde.json
          ),
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
          ...commonHandlerOptions(
            handler.handlerWrapper,
            this.options?.serde ?? serde.json
          ),
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
          ...commonHandlerOptions(
            handler.handlerWrapper,
            this.options?.serde ?? serde.json
          ),
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
      componentName: fragments[fragments.length - 2]!,
      handlerName: fragments[fragments.length - 1]!,
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
): Partial<d.Service> {
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
    retryPolicyExponentiationFactor: options?.retryPolicy?.exponentiationFactor,
    retryPolicyInitialInterval:
      options?.retryPolicy?.initialInterval !== undefined
        ? millisOrDurationToMillis(options?.retryPolicy?.initialInterval)
        : undefined,
    retryPolicyMaxInterval:
      options?.retryPolicy?.maxInterval !== undefined
        ? millisOrDurationToMillis(options?.retryPolicy?.maxInterval)
        : undefined,
    retryPolicyMaxAttempts: options?.retryPolicy?.maxAttempts,
    retryPolicyOnMaxAttempts: (options?.retryPolicy?.onMaxAttempts === "kill"
      ? "KILL"
      : options?.retryPolicy?.onMaxAttempts === "pause"
      ? "PAUSE"
      : undefined) as d.RetryPolicyOnMaxAttempts,
  };
}

function commonHandlerOptions(
  wrapper: HandlerWrapper,
  defaultSerde: Serde<any>
) {
  return {
    input: handlerInputDiscovery(wrapper, defaultSerde),
    output: handlerOutputDiscovery(wrapper, defaultSerde),
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
    retryPolicyExponentiationFactor: wrapper.retryPolicy?.exponentiationFactor,
    retryPolicyInitialInterval:
      wrapper.retryPolicy?.initialInterval !== undefined
        ? millisOrDurationToMillis(wrapper.retryPolicy?.initialInterval)
        : undefined,
    retryPolicyMaxInterval:
      wrapper.retryPolicy?.maxInterval !== undefined
        ? millisOrDurationToMillis(wrapper.retryPolicy?.maxInterval)
        : undefined,
    retryPolicyMaxAttempts: wrapper.retryPolicy?.maxAttempts,
    retryPolicyOnMaxAttempts: (wrapper.retryPolicy?.onMaxAttempts === "kill"
      ? "KILL"
      : wrapper.retryPolicy?.onMaxAttempts === "pause"
      ? "PAUSE"
      : undefined) as d.RetryPolicyOnMaxAttempts1,

    documentation: wrapper.description,
    metadata: wrapper.metadata,
  };
}
