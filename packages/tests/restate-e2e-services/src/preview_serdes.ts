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

type EchoInput = { value: string };
type EchoOutput = { value: string };

function prefixedSerde<T>(
  prefix: string,
  opts?: { preview?: boolean }
): Serde<T> {
  const prefixBytes = new TextEncoder().encode(`${prefix}:`);

  const serdeImpl: Serde<T> = {
    contentType: `application/x-${prefix.toLowerCase()}+json`,

    serialize(value: T): Uint8Array {
      const body = new TextEncoder().encode(JSON.stringify(value));
      const out = new Uint8Array(prefixBytes.length + body.length);
      out.set(prefixBytes, 0);
      out.set(body, prefixBytes.length);
      return out;
    },

    deserialize(data: Uint8Array): T {
      if (data.length < prefixBytes.length) {
        throw new Error(`Missing '${prefix}:' prefix`);
      }
      for (let i = 0; i < prefixBytes.length; i++) {
        if (data[i] !== prefixBytes[i]) {
          throw new Error(`Missing '${prefix}:' prefix`);
        }
      }
      return JSON.parse(
        new TextDecoder().decode(data.subarray(prefixBytes.length))
      ) as T;
    },
  };

  if (opts?.preview !== false) {
    serdeImpl.preview = {
      toJsonString(value: T): string {
        return JSON.stringify(value);
      },
      fromJsonString(json: string): T {
        return JSON.parse(json) as T;
      },
    };
  }

  return serdeImpl;
}

export const explicitAInputSerde = prefixedSerde<EchoInput>("explicit-a-input");
export const explicitAOutputSerde =
  prefixedSerde<EchoOutput>("explicit-a-output");
export const explicitBInputSerde = prefixedSerde<EchoInput>("explicit-b-input");
export const explicitBOutputSerde =
  prefixedSerde<EchoOutput>("explicit-b-output");
export const handlerDefaultSerde = prefixedSerde<EchoInput>("handler-default");
export const serviceDefaultSerde = prefixedSerde<EchoInput>("service-default");
const noPreviewSerde = prefixedSerde<EchoInput>("no-preview", {
  preview: false,
});

const previewSerdeCases = restate.service({
  name: "PreviewSerdeCases",
  handlers: {
    explicitA: restate.handlers.handler(
      {
        input: explicitAInputSerde,
        output: explicitAOutputSerde,
      },
      async (_ctx: restate.Context, input: EchoInput): Promise<EchoOutput> => {
        return { value: `explicit-a:${input.value}` };
      }
    ),

    explicitB: restate.handlers.handler(
      {
        input: explicitBInputSerde,
        output: explicitBOutputSerde,
      },
      async (_ctx: restate.Context, input: EchoInput): Promise<EchoOutput> => {
        return { value: `explicit-b:${input.value}` };
      }
    ),

    handlerDefault: restate.handlers.handler(
      { serde: handlerDefaultSerde },
      async (_ctx: restate.Context, input: EchoInput): Promise<EchoOutput> => {
        return { value: `handler-default:${input.value}` };
      }
    ),

    noPreview: restate.handlers.handler(
      {
        input: noPreviewSerde,
        output: noPreviewSerde,
      },
      async (_ctx: restate.Context, input: EchoInput): Promise<EchoInput> => {
        return input;
      }
    ),

    jsonDefault: async (
      _ctx: restate.Context,
      input: EchoInput
    ): Promise<EchoOutput> => {
      return { value: `json-default:${input.value}` };
    },
  },
});

const previewSerdeServiceDefault = restate.service({
  name: "PreviewSerdeServiceDefault",
  handlers: {
    invoke: async (
      _ctx: restate.Context,
      input: EchoInput
    ): Promise<EchoOutput> => {
      return { value: `service-default:${input.value}` };
    },
  },
  options: {
    serde: serviceDefaultSerde,
  },
});

REGISTRY.addService(previewSerdeCases);
REGISTRY.addService(previewSerdeServiceDefault);

export type PreviewSerdeCases = typeof previewSerdeCases;
export type PreviewSerdeServiceDefault = typeof previewSerdeServiceDefault;
