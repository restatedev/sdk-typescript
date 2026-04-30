// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import * as restate from "@restatedev/restate-sdk";
import type { Serde } from "@restatedev/restate-sdk";
import { REGISTRY } from "./services.js";

export type IngressSerdePayload = {
  value: string;
};

export type AwakeableRequest = {
  useOverrideSerde?: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function prefixedJsonSerde<T>(prefix: string): Serde<T> {
  const prefixBytes = encoder.encode(`${prefix}:`);

  return {
    contentType: `application/x-${prefix}+json`,

    serialize(value: T): Uint8Array {
      if (value === undefined) {
        return new Uint8Array(0);
      }
      const body = encoder.encode(JSON.stringify(value));
      const out = new Uint8Array(prefixBytes.length + body.length);
      out.set(prefixBytes);
      out.set(body, prefixBytes.length);
      return out;
    },

    deserialize(data: Uint8Array): T {
      if (data.length === 0) {
        return undefined as T;
      }
      if (data.length < prefixBytes.length) {
        throw new Error(`Missing '${prefix}:' prefix`);
      }
      for (let i = 0; i < prefixBytes.length; i++) {
        if (data[i] !== prefixBytes[i]) {
          throw new Error(`Missing '${prefix}:' prefix`);
        }
      }

      return JSON.parse(decoder.decode(data.subarray(prefixBytes.length))) as T;
    },
  };
}

export const ingressDefaultSerde =
  prefixedJsonSerde<unknown>("ingress-default");
export const ingressOverrideSerde =
  prefixedJsonSerde<IngressSerdePayload>("ingress-override");

function response(label: string, input: IngressSerdePayload) {
  return { value: `${label}:${input.value}` };
}

const ingressDefaultSerdeService = restate.service({
  name: "IngressDefaultSerdeService",
  handlers: {
    echo: async (
      _ctx: restate.Context,
      input: IngressSerdePayload
    ): Promise<IngressSerdePayload> => response("service", input),

    echoOverride: restate.handlers.handler(
      {
        input: ingressOverrideSerde,
        output: ingressOverrideSerde,
      },
      async (
        _ctx: restate.Context,
        input: IngressSerdePayload
      ): Promise<IngressSerdePayload> => response("service-override", input)
    ),
  },
  options: {
    serde: ingressDefaultSerde,
  },
});

const ingressDefaultSerdeObject = restate.object({
  name: "IngressDefaultSerdeObject",
  handlers: {
    echo: async (
      _ctx: restate.ObjectContext,
      input: IngressSerdePayload
    ): Promise<IngressSerdePayload> => response("object", input),

    echoOverride: restate.handlers.object.exclusive(
      {
        input: ingressOverrideSerde,
        output: ingressOverrideSerde,
      },
      async (
        _ctx: restate.ObjectContext,
        input: IngressSerdePayload
      ): Promise<IngressSerdePayload> => response("object-override", input)
    ),
  },
  options: {
    serde: ingressDefaultSerde,
  },
});

const ingressDefaultSerdeAwakeableObject = restate.object({
  name: "IngressDefaultSerdeAwakeableObject",
  handlers: {
    wait: async (
      ctx: restate.ObjectContext,
      request: AwakeableRequest
    ): Promise<IngressSerdePayload> => {
      const { id, promise } = ctx.awakeable<IngressSerdePayload>(
        request.useOverrideSerde ? ingressOverrideSerde : undefined
      );
      ctx.set("awakeableId", id);
      return promise;
    },

    getAwakeableId: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<string | null> => {
        return ctx.get<string>("awakeableId");
      }
    ),
  },
  options: {
    serde: ingressDefaultSerde,
  },
});

const ingressDefaultSerdeWorkflow = restate.workflow({
  name: "IngressDefaultSerdeWorkflow",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext,
      input: IngressSerdePayload
    ): Promise<IngressSerdePayload> => {
      ctx.set("input", input);
      return response("workflow", input);
    },
  },
  options: {
    serde: ingressDefaultSerde,
  },
});

const ingressOverrideSerdeWorkflow = restate.workflow({
  name: "IngressOverrideSerdeWorkflow",
  handlers: {
    run: restate.handlers.workflow.workflow(
      {
        input: ingressOverrideSerde,
        output: ingressOverrideSerde,
      },
      async (
        _ctx: restate.WorkflowContext,
        input: IngressSerdePayload
      ): Promise<IngressSerdePayload> => response("workflow-override", input)
    ),
  },
  options: {
    serde: ingressDefaultSerde,
  },
});

REGISTRY.addService(ingressDefaultSerdeService);
REGISTRY.addObject(ingressDefaultSerdeObject);
REGISTRY.addObject(ingressDefaultSerdeAwakeableObject);
REGISTRY.addWorkflow(ingressDefaultSerdeWorkflow);
REGISTRY.addWorkflow(ingressOverrideSerdeWorkflow);

export type IngressDefaultSerdeService = typeof ingressDefaultSerdeService;
export type IngressDefaultSerdeObject = typeof ingressDefaultSerdeObject;
export type IngressDefaultSerdeAwakeableObject =
  typeof ingressDefaultSerdeAwakeableObject;
export type IngressDefaultSerdeWorkflow = typeof ingressDefaultSerdeWorkflow;
export type IngressOverrideSerdeWorkflow = typeof ingressOverrideSerdeWorkflow;
