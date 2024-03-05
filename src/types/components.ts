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

import { Context, ObjectContext } from "../context";
import * as d from "./discovery";
import { ContextImpl } from "../context_impl";
import { deserializeJson, serializeJson } from "../utils/serde";

//
// Interfaces
//
export interface Component {
  name(): string;
  handlerMatching(url: UrlPathComponents): ComponentHandler | undefined;
  discovery(): d.Component;
}

export interface ComponentHandler {
  name(): string;
  component(): Component;
  invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array>;
}

//
// Service
//

export type ServiceHandlerFunction<I, O> = (
  ctx: Context,
  param: I
) => Promise<O>;

export type ServiceHandlerOpts<I, O> = {
  name: string;
  fn: ServiceHandlerFunction<I, O>;
};

export class ServiceComponent implements Component {
  private readonly handlers: Map<string, ServiceHandler> = new Map();

  constructor(private readonly componentName: string) {}

  name(): string {
    return this.componentName;
  }

  add<I, O>(opts: ServiceHandlerOpts<I, O>) {
    const c = new ServiceHandler(opts, this);
    this.handlers.set(opts.name, c);
  }

  discovery(): d.Component {
    const handlers: d.Handler[] = [...this.handlers.keys()].map((name) => {
      return {
        name,
      };
    });

    return {
      fullyQualifiedComponentName: this.componentName,
      componentType: d.ComponentType.SERVICE,
      handlers,
    };
  }

  handlerMatching(url: UrlPathComponents): ComponentHandler | undefined {
    return this.handlers.get(url.handlerName);
  }
}

export class ServiceHandler implements ComponentHandler {
  private readonly handlerName: string;
  private readonly parent: ServiceComponent;
  private readonly fn: ServiceHandlerFunction<any, any>;

  constructor(opts: ServiceHandlerOpts<any, any>, parent: ServiceComponent) {
    this.handlerName = opts.name;
    this.parent = parent;
    this.fn = opts.fn;
  }

  async invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array> {
    const req = deserializeJson(input);
    const res = await this.fn(context, req);
    return serializeJson(res);
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

export type VirtualObjectHandlerFunction<I, O> = (
  ctx: ObjectContext,
  param: I
) => Promise<O>;

export type VirtualObjectHandlerOpts<I, O> = {
  name: string;
  fn: VirtualObjectHandlerFunction<I, O>;
};

export class VritualObjectComponent implements Component {
  private readonly opts: Map<string, VirtualObjectHandlerOpts<any, any>> =
    new Map();

  constructor(public readonly componentName: string) {}

  name(): string {
    return this.componentName;
  }

  add<I, O>(opts: VirtualObjectHandlerOpts<I, O>) {
    this.opts.set(opts.name, opts as VirtualObjectHandlerOpts<any, any>);
  }

  discovery(): d.Component {
    const handlers: d.Handler[] = [...this.opts.keys()].map((name) => {
      return {
        name,
      };
    });

    return {
      fullyQualifiedComponentName: this.componentName,
      componentType: d.ComponentType.VIRTUAL_OBJECT,
      handlers,
    };
  }

  handlerMatching(url: UrlPathComponents): ComponentHandler | undefined {
    const opts = this.opts.get(url.handlerName);
    if (!opts) {
      return undefined;
    }
    return new VirtualObjectHandler(url.handlerName, this, opts);
  }
}

export class VirtualObjectHandler implements ComponentHandler {
  constructor(
    private readonly componentName: string,
    private readonly parent: VritualObjectComponent,
    private readonly opts: VirtualObjectHandlerOpts<any, any>
  ) {}

  name(): string {
    return this.componentName;
  }
  component(): Component {
    return this.parent;
  }

  async invoke(context: ContextImpl, input: Uint8Array): Promise<Uint8Array> {
    const req = deserializeJson(input);
    const res = await this.opts.fn(context, req);
    return serializeJson(res);
  }
}

export type UrlPathComponents = {
  componentName: string;
  handlerName: string;
};

export function parseUrlComponents(
  urlPath?: string
): UrlPathComponents | "discovery" | undefined {
  if (!urlPath) {
    return undefined;
  }
  const fragments = urlPath.split("/");
  if (fragments.length >= 3 && fragments[fragments.length - 3] === "invoke") {
    return {
      componentName: fragments[fragments.length - 2],
      handlerName: fragments[fragments.length - 1],
    };
  }
  if (fragments.length > 0 && fragments[fragments.length - 1] === "discover") {
    return "discovery";
  }
  return undefined;
}
