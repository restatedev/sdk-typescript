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
  ServiceHandlerOpts,
  ServiceOptions,
  WorkflowOptions,
} from "../types/rpc.js";
import { HandlerKind } from "../types/rpc.js";
import type { Serde } from "@restatedev/restate-sdk-core";
import { millisOrDurationToMillis, serde } from "@restatedev/restate-sdk-core";
import type { HooksProvider } from "../hooks.js";
import type { TerminalError } from "../types/errors.js";

//
// Interfaces
//
export interface Component {
  name(): string;
  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined;
  serdeMatching(name: string): Serde<any> | undefined;
  discovery(): d.Service;
}

/**
 * Execution-related options
 */
export interface ExecutionOptions {
  asTerminalError?: (error: any) => TerminalError | undefined;
  /**
   * Default serde to use for requests, responses, state, side effects, awakeables, promises. Used when no other serde is specified.
   */
  defaultSerde: Serde<any>;
  hooks?: HooksProvider[];
  explicitCancellation?: boolean;
}

export interface ComponentHandler {
  name(): string;
  component(): Component;
  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array>;
  kind(): HandlerKind;

  /**
   * Returns the execution options, already merged with different layers (endpoint -> service -> handler)
   */
  executionOptions: ExecutionOptions;
}

//
// Service
//

function handlerInputDiscovery(
  handler: HandlerWrapper,
  defaultSerde: Serde<any>
): d.InputPayload {
  const serde = handler.options?.input ?? defaultSerde;

  let contentType = undefined;
  let jsonSchema = undefined;

  if (serde.jsonSchema) {
    jsonSchema = serde.jsonSchema;
    contentType = handler.options?.accept ?? serde.contentType;
  } else if (handler.options?.accept) {
    contentType = handler.options?.accept;
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
  const serde = handler.options?.output ?? defaultSerde;
  const setContentTypeIfEmpty =
    handler.options?.setOutputContentTypeIfEmpty ?? false;

  let contentType = undefined;
  let jsonSchema = undefined;

  if (serde.jsonSchema) {
    jsonSchema = serde.jsonSchema;
    contentType = serde.contentType ?? "application/json";
  } else if (serde.contentType) {
    contentType = serde.contentType;
  } else {
    // no input information
    return { setContentTypeIfEmpty };
  }

  return {
    setContentTypeIfEmpty,
    jsonSchema,
    contentType,
  };
}

function createExecutionOptions(
  serviceOptions?: ServiceOptions,
  handlerOptions?: ServiceHandlerOpts<unknown, unknown>
): ExecutionOptions {
  const defaultSerde =
    handlerOptions?.serde ?? serviceOptions?.serde ?? serde.json;

  // Service-level hooks run outermost, handler-level hooks run innermost.
  // Both are merged into a single list: service hooks first, then handler hooks.
  const hooks = [
    ...(serviceOptions?.hooks ?? []),
    ...(handlerOptions?.hooks ?? []),
  ];
  return {
    defaultSerde,
    asTerminalError:
      handlerOptions?.asTerminalError ?? serviceOptions?.asTerminalError,
    hooks: hooks.length > 0 ? hooks : undefined,
    explicitCancellation:
      handlerOptions?.explicitCancellation ??
      serviceOptions?.explicitCancellation,
  };
}

const PREVIEW_METADATA_KEY_PREFIX = "restate.serde.preview";

/**
 * Service-scoped serde namespace.
 *
 * Today it is populated from handler inputs/outputs under `<handler>/input`
 * and `<handler>/output`. Custom service-level serdes can be registered
 * alongside them under any name.
 */
class ServiceSerdeRegistry {
  private readonly serdes = new Map<string, Serde<unknown>>();

  registerHandlerIO(
    handlerName: string,
    wrapper: HandlerWrapper,
    executionOptions: ExecutionOptions
  ): void {
    this.serdes.set(
      `${handlerName}/input`,
      wrapper.options?.input ?? executionOptions.defaultSerde
    );
    this.serdes.set(
      `${handlerName}/output`,
      wrapper.options?.output ?? executionOptions.defaultSerde
    );
  }

  resolve(name: string): Serde<unknown> | undefined {
    return this.serdes.get(name);
  }

  previewMetadata(): Record<string, string> | undefined {
    const metadata: Record<string, string> = {};
    for (const [name, s] of this.serdes) {
      if (s.preview) {
        metadata[`${PREVIEW_METADATA_KEY_PREFIX}.${name}`] = "true";
      }
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }
}

function mergeMetadata(
  baseMetadata?: Record<string, string>,
  additionalMetadata?: Record<string, string>
): Record<string, string> | undefined {
  if (!baseMetadata && !additionalMetadata) {
    return undefined;
  }

  return {
    ...(baseMetadata ?? {}),
    ...(additionalMetadata ?? {}),
  };
}

export class ServiceComponent implements Component {
  private readonly handlers: Map<string, ServiceHandler> = new Map();
  private readonly serdeRegistry = new ServiceSerdeRegistry();

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
    const handler = new ServiceHandler(name, handlerWrapper, this);
    this.handlers.set(name, handler);
    this.serdeRegistry.registerHandlerIO(
      name,
      handlerWrapper,
      handler.executionOptions
    );
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          ...commonHandlerOptions(
            handler.handlerWrapper,
            handler.executionOptions.defaultSerde
          ),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "SERVICE",
      handlers,
      documentation: this.description,
      metadata: mergeMetadata(
        this.metadata,
        this.serdeRegistry.previewMetadata()
      ),
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }

  serdeMatching(name: string): Serde<any> | undefined {
    return this.serdeRegistry.resolve(name);
  }
}

export class ServiceHandler implements ComponentHandler {
  readonly executionOptions: ExecutionOptions;

  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: ServiceComponent
  ) {
    this.executionOptions = createExecutionOptions(
      this.parent.options,
      handlerWrapper.options
    );
  }

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
  private readonly serdeRegistry = new ServiceSerdeRegistry();

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
    const handler = new VirtualObjectHandler(name, wrapper, this);
    this.handlers.set(name, handler);
    this.serdeRegistry.registerHandlerIO(
      name,
      wrapper,
      handler.executionOptions
    );
  }

  discovery(): d.Service {
    const handlers: d.Handler[] = [...this.handlers.entries()].map(
      ([name, handler]) => {
        return {
          name,
          ty: handler.kind() === HandlerKind.EXCLUSIVE ? "EXCLUSIVE" : "SHARED",
          ...commonHandlerOptions(
            handler.handlerWrapper,
            handler.executionOptions.defaultSerde
          ),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "VIRTUAL_OBJECT",
      handlers,
      documentation: this.description,
      metadata: mergeMetadata(
        this.metadata,
        this.serdeRegistry.previewMetadata()
      ),
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }

  serdeMatching(name: string): Serde<any> | undefined {
    return this.serdeRegistry.resolve(name);
  }
}

export class VirtualObjectHandler implements ComponentHandler {
  readonly executionOptions: ExecutionOptions;

  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: VirtualObjectComponent
  ) {
    this.executionOptions = createExecutionOptions(
      this.parent.options,
      handlerWrapper.options
    );
  }

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
  private readonly serdeRegistry = new ServiceSerdeRegistry();

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
    const handler = new WorkflowHandler(name, wrapper, this);
    this.handlers.set(name, handler);
    this.serdeRegistry.registerHandlerIO(
      name,
      wrapper,
      handler.executionOptions
    );
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
            handler.executionOptions.defaultSerde
          ),
        } satisfies d.Handler;
      }
    );

    return {
      name: this.componentName,
      ty: "WORKFLOW",
      handlers,
      documentation: this.description,
      metadata: mergeMetadata(
        this.metadata,
        this.serdeRegistry.previewMetadata()
      ),
      ...commonServiceOptions(this.options),
    } satisfies d.Service;
  }

  handlerMatching(url: InvokePathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }

  serdeMatching(name: string): Serde<any> | undefined {
    return this.serdeRegistry.resolve(name);
  }
}

export class WorkflowHandler implements ComponentHandler {
  readonly executionOptions: ExecutionOptions;

  constructor(
    private readonly handlerName: string,
    public readonly handlerWrapper: HandlerWrapper,
    private readonly parent: WorkflowComponent
  ) {
    this.executionOptions = createExecutionOptions(
      this.parent.options,
      handlerWrapper.options
    );
  }

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
  | PreviewPathComponents
  | { type: "discover" }
  | { type: "health" }
  | { type: "unknown"; path: string };

export type InvokePathComponents = {
  type: "invoke";
  componentName: string;
  handlerName: string;
};

export type PreviewPathComponents = {
  type: "preview";
  componentName: string;
  operation: "decode" | "encode";
  serdeName: string;
};

// Preview uses a regex so that `serdeName` can span multiple path segments
// (built-ins are shaped as `<handler>/(input|output)`). The regex is anchored
// with `(?:^|\/)` so deployments mounted under a sub-path also work.
const PREVIEW_PATH_REGEX =
  /(?:^|\/)serdes\/(?<componentName>[^/]+)\/(?<operation>encode|decode)\/(?<serdeName>.+?)\/?$/;

export function parseUrlComponents(urlPath?: string): PathComponents {
  if (!urlPath) {
    return { type: "unknown", path: "" };
  }

  const preview = PREVIEW_PATH_REGEX.exec(urlPath);
  if (preview?.groups) {
    return {
      type: "preview",
      componentName: preview.groups.componentName!,
      operation: preview.groups.operation as "decode" | "encode",
      serdeName: preview.groups.serdeName!,
    };
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
      wrapper.options?.journalRetention !== undefined
        ? millisOrDurationToMillis(wrapper.options?.journalRetention)
        : undefined,
    idempotencyRetention:
      wrapper.options?.idempotencyRetention !== undefined
        ? millisOrDurationToMillis(wrapper.options?.idempotencyRetention)
        : undefined,
    inactivityTimeout:
      wrapper.options?.inactivityTimeout !== undefined
        ? millisOrDurationToMillis(wrapper.options?.inactivityTimeout)
        : undefined,
    abortTimeout:
      wrapper.options?.abortTimeout !== undefined
        ? millisOrDurationToMillis(wrapper.options?.abortTimeout)
        : undefined,
    ingressPrivate: wrapper.options?.ingressPrivate,
    enableLazyState:
      wrapper.options !== undefined && "enableLazyState" in wrapper.options
        ? wrapper.options?.enableLazyState
        : undefined,
    retryPolicyExponentiationFactor:
      wrapper.options?.retryPolicy?.exponentiationFactor,
    retryPolicyInitialInterval:
      wrapper.options?.retryPolicy?.initialInterval !== undefined
        ? millisOrDurationToMillis(
            wrapper.options?.retryPolicy?.initialInterval
          )
        : undefined,
    retryPolicyMaxInterval:
      wrapper.options?.retryPolicy?.maxInterval !== undefined
        ? millisOrDurationToMillis(wrapper.options?.retryPolicy?.maxInterval)
        : undefined,
    retryPolicyMaxAttempts: wrapper.options?.retryPolicy?.maxAttempts,
    retryPolicyOnMaxAttempts: (wrapper.options?.retryPolicy?.onMaxAttempts ===
    "kill"
      ? "KILL"
      : wrapper.options?.retryPolicy?.onMaxAttempts === "pause"
        ? "PAUSE"
        : undefined) as d.RetryPolicyOnMaxAttempts1,

    documentation: wrapper.options?.description,
    metadata: wrapper.options?.metadata,
  };
}
