/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Serde } from "./serde_api.js";
import { serde } from "./serde_api.js";
import type { StandardSchemaV1 } from "./standard_schema.js";
import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "./core.js";

/**
 * Minimal descriptor stored in {@link Descriptor}._handlers per handler.
 */
export type HandlerDescriptor<
  I = any,
  O = any,
  Shared extends boolean = boolean,
> = {
  readonly _inputSerde?: Serde<I>;
  readonly _outputSerde?: Serde<O>;
  /** @internal virtual-object handler shared/exclusive marker (phantom + runtime) */
  readonly _shared?: Shared;
};

export function makeHandlerDescriptor<I, O, Shared extends boolean = false>(
  inputSerde?: Serde<I>,
  outputSerde?: Serde<O>,
  shared?: Shared
): HandlerDescriptor<I, O, Shared> {
  return {
    _inputSerde: inputSerde,
    _outputSerde: outputSerde,
    _shared: shared,
  };
}

/** Recover the input type declared by a {@link HandlerDescriptor}. */
export type InferInput<D> =
  D extends HandlerDescriptor<infer I, any, any> ? I : any;
/** Recover the output type declared by a {@link HandlerDescriptor}. */
export type InferOutput<D> =
  D extends HandlerDescriptor<any, infer O, any> ? O : any;
/** Recover the value type carried by a {@link Serde}. */
export type SerdeType<S> = S extends Serde<infer T> ? T : never;

// =============================================================================
// Descriptor — the client-facing definition value carrying `_handlers`.
//
// - `iface.service/object/workflow(...)` return a pure Descriptor (no fn), safe
//   to place in a shared package imported by both server and callers.
// - the SDKs' `implement()` / `service()` factories return an
//   `Implemented*Definition`, which is a Descriptor that is ALSO bindable.
// =============================================================================

export type Descriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
  Kind extends "service" | "object" | "workflow" =
    | "service"
    | "object"
    | "workflow",
> = {
  readonly name: P;
  readonly _kind: Kind;
  readonly _handlers: H;
};

export type ServiceDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "service">;

export type ObjectDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "object">;

export type WorkflowDescriptor<
  P extends string = string,
  H extends Record<string, HandlerDescriptor> = Record<
    string,
    HandlerDescriptor
  >,
> = Descriptor<P, H, "workflow">;

/** Implemented definition — a Descriptor that is also bindable to an endpoint. */
export type ImplementedServiceDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = ServiceDefinition<P, any> & ServiceDescriptor<P, H>;

export type ImplementedObjectDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = VirtualObjectDefinition<P, any> & ObjectDescriptor<P, H>;

export type ImplementedWorkflowDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
> = WorkflowDefinition<P, any> & WorkflowDescriptor<P, H>;

export type ImplementedDefinition<
  P extends string,
  H extends Record<string, HandlerDescriptor>,
  Kind extends "service" | "object" | "workflow",
> = Kind extends "service"
  ? ImplementedServiceDefinition<P, H>
  : Kind extends "object"
    ? ImplementedObjectDefinition<P, H>
    : ImplementedWorkflowDefinition<P, H>;

/** The shape of the {@link iface} service-interface declaration API. */
export interface ServiceInterface {
  service<P extends string, H extends Record<string, HandlerDescriptor>>(
    name: P,
    handlers: H
  ): ServiceDescriptor<P, H>;
  object<P extends string, H extends Record<string, HandlerDescriptor>>(
    name: P,
    handlers: H
  ): ObjectDescriptor<P, H>;
  workflow<P extends string, H extends Record<string, HandlerDescriptor>>(
    name: P,
    handlers: H
  ): WorkflowDescriptor<P, H>;
  /** `json<I, O>()` — type params, default JSON serde. */
  json<I = void, O = void>(): HandlerDescriptor<I, O, false>;
  /** `serdes({ input, output })` — explicit Serde per direction. */
  serdes<SI extends Serde<any>, SO extends Serde<any>>(opts: {
    input?: SI;
    output?: SO;
  }): HandlerDescriptor<SerdeType<SI>, SerdeType<SO>, false>;
  /** `schemas({ input, output })` — Standard Schema per direction. */
  schemas<
    SI extends StandardSchemaV1<any>,
    SO extends StandardSchemaV1<any>,
  >(opts: {
    input?: SI;
    output?: SO;
  }): HandlerDescriptor<
    StandardSchemaV1.InferOutput<NonNullable<SI>>,
    StandardSchemaV1.InferOutput<NonNullable<SO>>,
    false
  >;
  /** Shared (read-only) virtual-object / non-`run` workflow handler declarators. */
  shared: {
    json<I = void, O = void>(): HandlerDescriptor<I, O, true>;
    serdes<SI extends Serde<any>, SO extends Serde<any>>(opts: {
      input?: SI;
      output?: SO;
    }): HandlerDescriptor<SerdeType<SI>, SerdeType<SO>, true>;
    schemas<
      SI extends StandardSchemaV1<any>,
      SO extends StandardSchemaV1<any>,
    >(opts: {
      input?: SI;
      output?: SO;
    }): HandlerDescriptor<
      StandardSchemaV1.InferOutput<NonNullable<SI>>,
      StandardSchemaV1.InferOutput<NonNullable<SO>>,
      true
    >;
  };
}

/**
 * Declare a service interface (contract) as a runtime value carrying handler
 * names + input/output serdes, without an implementation. Place it in a shared
 * package that both the server (via `implement()`) and callers (via
 * `ctx.serviceClient(iface)` / `connect().serviceClient(iface)`) import.
 *
 * @example
 * ```ts
 * const greeter = iface.service("greeter", {
 *   greet: iface.schemas({ input: GreetReq, output: GreetRes }),
 *   ping:  iface.json<void, string>(),
 * });
 * ```
 */
export const iface: ServiceInterface = {
  service: function <
    P extends string,
    H extends Record<string, HandlerDescriptor>,
  >(name: P, handlers: H): ServiceDescriptor<P, H> {
    return { name, _kind: "service", _handlers: handlers };
  },
  object: function <
    P extends string,
    H extends Record<string, HandlerDescriptor>,
  >(name: P, handlers: H): ObjectDescriptor<P, H> {
    return { name, _kind: "object", _handlers: handlers };
  },
  workflow: function <
    P extends string,
    H extends Record<string, HandlerDescriptor>,
  >(name: P, handlers: H): WorkflowDescriptor<P, H> {
    return { name, _kind: "workflow", _handlers: handlers };
  },
  json: function <I = void, O = void>(): HandlerDescriptor<I, O, false> {
    return makeHandlerDescriptor<I, O, false>(undefined, undefined, false);
  },
  serdes: function <SI extends Serde<any>, SO extends Serde<any>>(opts: {
    input?: SI;
    output?: SO;
  }): HandlerDescriptor<SerdeType<SI>, SerdeType<SO>, false> {
    return makeHandlerDescriptor<any, any, false>(
      opts.input,
      opts.output,
      false
    );
  },
  schemas: function <
    SI extends StandardSchemaV1<any>,
    SO extends StandardSchemaV1<any>,
  >(opts: {
    input?: SI;
    output?: SO;
  }): HandlerDescriptor<
    StandardSchemaV1.InferOutput<NonNullable<SI>>,
    StandardSchemaV1.InferOutput<NonNullable<SO>>,
    false
  > {
    return makeHandlerDescriptor<any, any, false>(
      opts.input ? serde.schema(opts.input) : undefined,
      opts.output ? serde.schema(opts.output) : undefined,
      false
    );
  },
  shared: {
    json: function <I = void, O = void>(): HandlerDescriptor<I, O, true> {
      return makeHandlerDescriptor<I, O, true>(undefined, undefined, true);
    },
    serdes: function <SI extends Serde<any>, SO extends Serde<any>>(opts: {
      input?: SI;
      output?: SO;
    }): HandlerDescriptor<SerdeType<SI>, SerdeType<SO>, true> {
      return makeHandlerDescriptor<any, any, true>(
        opts.input,
        opts.output,
        true
      );
    },
    schemas: function <
      SI extends StandardSchemaV1<any>,
      SO extends StandardSchemaV1<any>,
    >(opts: {
      input?: SI;
      output?: SO;
    }): HandlerDescriptor<
      StandardSchemaV1.InferOutput<NonNullable<SI>>,
      StandardSchemaV1.InferOutput<NonNullable<SO>>,
      true
    > {
      return makeHandlerDescriptor<any, any, true>(
        opts.input ? serde.schema(opts.input) : undefined,
        opts.output ? serde.schema(opts.output) : undefined,
        true
      );
    },
  },
};
