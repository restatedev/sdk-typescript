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
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import type { Serde } from "@restatedev/restate-sdk-core";

import * as z3 from "zod/v3";
import * as z4 from "zod/v4/core";
import { zodToJsonSchema } from "zod-to-json-schema";

export type { Serde } from "@restatedev/restate-sdk-core";

type ZodType = z3.ZodTypeAny | z4.$ZodType;
type output<T> = T extends z3.ZodTypeAny ? z3.infer<T> : z4.infer<T>;

class ZodSerde<T extends ZodType> implements Serde<output<T>> {
  contentType? = "application/json";
  jsonSchema?: object | undefined;

  constructor(private readonly schema: T) {
      if ("_zod" in schema) {
          this.jsonSchema = z4.toJSONSchema(schema);
      } else if (schema instanceof z3.ZodType) {
          // zod3 fallback
          this.jsonSchema = zodToJsonSchema(schema as never);
      } else {
          this.jsonSchema = undefined;
      }

      if (schema instanceof z3.ZodVoid
          || schema instanceof z3.ZodUndefined
          || schema instanceof z4.$ZodVoid
          || schema instanceof z4.$ZodUndefined) {
          this.contentType = undefined;
      }
  }

  serialize(value: output<T>): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }
    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): output<T> {
    const js =
      data.length === 0
        ? undefined
        : JSON.parse(new TextDecoder().decode(data));
    if ('safeParse' in this.schema && typeof this.schema.safeParse === 'function') {
        const res = this.schema.safeParse(js);
        if (res.success) {
            return res.data;
        }
        throw res.error;
    } else {
        throw new TypeError("Unsupported data type. Expected 'safeParse'.");
    }
  }
}

export namespace serde {
  /**
   * A Zod-based serde.
   *
   * @param zodType the zod type
   * @returns a serde that will validate the data with the zod schema
   */
  export const zod = <T extends ZodType>(zodType: T): Serde<output<T>> => {
    return new ZodSerde(zodType);
  };
}
