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

/* eslint-disable @typescript-eslint/no-namespace */

import type { Serde } from "@restatedev/restate-sdk-core";

import * as z3 from "zod/v3";
import * as z4 from "zod/v4/core";

export type { Serde } from "@restatedev/restate-sdk-core";

let zod3WarningPrinted = false;
function printZod3Warning() {
  if (!zod3WarningPrinted) {
    console.warn(
      "Detected usage of Zod V3, JSON schemas won't be correctly generated. Please update to Zod V4, or downgrade restate-sdk-zod to 1.8.3"
    );
    zod3WarningPrinted = true;
  }
}

class ZodSerde<T extends z3.ZodTypeAny | z4.$ZodType>
  implements Serde<T extends z3.ZodTypeAny ? z3.infer<T> : z4.infer<T>>
{
  contentType? = "application/json";
  jsonSchema?: object | undefined;

  constructor(private readonly schema: T) {
    if ("_zod" in schema) {
      this.jsonSchema = z4.toJSONSchema(schema, {
        unrepresentable: "any",
      });
    } else if (schema instanceof z3.ZodType) {
      printZod3Warning();
      this.jsonSchema = undefined;
    }

    if (
      schema instanceof z3.ZodVoid ||
      schema instanceof z3.ZodUndefined ||
      schema instanceof z4.$ZodVoid ||
      schema instanceof z4.$ZodUndefined
    ) {
      this.contentType = undefined;
    }
  }

  serialize(
    value: T extends z3.ZodTypeAny ? z3.infer<T> : z4.infer<T>
  ): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }
    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(
    data: Uint8Array
  ): T extends z3.ZodTypeAny ? z3.infer<T> : z4.infer<T> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const js =
      data.length === 0
        ? undefined
        : JSON.parse(new TextDecoder().decode(data));
    if (
      "safeParse" in this.schema &&
      typeof this.schema.safeParse === "function"
    ) {
      const res = this.schema.safeParse(js);
      if (res.success) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
  export const zod = <T extends z3.ZodTypeAny | z4.$ZodType>(
    zodType: T
  ): Serde<T extends z3.ZodTypeAny ? z3.infer<T> : z4.infer<T>> => {
    return new ZodSerde(zodType);
  };
}
