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

import { z, ZodVoid } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type { Serde } from "@restatedev/restate-sdk-core";

class ZodSerde<T extends z.ZodType> implements Serde<z.infer<T>> {
  contentType? = "application/json";
  jsonSchema?: object | undefined;

  constructor(private readonly schema: T) {
    this.jsonSchema = zodToJsonSchema(schema);
    if (schema instanceof ZodVoid || schema instanceof z.ZodUndefined) {
      this.contentType = undefined;
    }
  }

  serialize(value: T): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }
    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): T {
    const js =
      data.length === 0
        ? undefined
        : JSON.parse(new TextDecoder().decode(data));

    const res = this.schema.safeParse(js);
    if (res.success) {
      return res.data;
    }
    throw res.error;
  }
}

export namespace serde {
  /**
   * A Zod based serde.
   *
   * @param schema the zod type
   * @returns a serde that will validate the data with the zod schema
   */
  export const zod = <T extends z.ZodType>(zodType: T): Serde<z.infer<T>> => {
    return new ZodSerde(zodType);
  };
}
