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

import type {StandardJSONSchemaV1, StandardSchemaV1} from "@standard-schema/spec";

export interface Serde<T> {
  contentType?: string;
  jsonSchema?: object;

  serialize(value: T): Uint8Array;

  deserialize(data: Uint8Array): T;
}

class BinarySerde implements Serde<Uint8Array> {
  contentType = "application/octet-stream";

  serialize(value: Uint8Array): Uint8Array {
    return value;
  }

  deserialize(data: Uint8Array): Uint8Array {
    return data;
  }
}

class VoidSerde implements Serde<void> {
  serialize(value: any): Uint8Array {
    if (value !== undefined) {
      throw new Error("Expected undefined value");
    }
    return new Uint8Array(0);
  }

  deserialize(data: Uint8Array): void {
    if (data.length !== 0) {
      throw new Error("Expected empty data");
    }
  }
}

class StandardSchemaSerde<
  T extends { "~standard": StandardSchemaV1.Props },
> implements Serde<StandardSchemaV1.InferOutput<T>>
{
  contentType? = "application/json";
  jsonSchema?: object | undefined;

  constructor(private readonly schema: T, private readonly validateOptions?: Record<string, unknown>, jsonSchemaOptions?: Record<string, unknown>) {
    // Extract JSON schema if available
    const standard = schema["~standard"];
    if (isStandardJSONSchemaV1(standard)) {
      try {
        this.jsonSchema = (standard as unknown as StandardJSONSchemaV1.Props).jsonSchema.output({
          target: "draft-2020-12",
          libraryOptions: jsonSchemaOptions
        })
      } catch {
        // If JSON schema generation fails, leave it undefined
        this.jsonSchema = undefined;
      }
    }

    // Check if schema is for void/undefined type
    // Standard Schema doesn't have a direct way to detect void types,
    // so we serialize undefined and check if validation succeeds
    const testResult = standard.validate(undefined);
    // Handle both sync and async validation results
    if (testResult && typeof testResult === "object" && "then" in testResult) {
      // If it's a Promise, we can't determine contentType synchronously
      // Keep contentType as "application/json"
    } else if (!testResult.issues) {
      this.contentType = undefined;
    }
  }

  serialize(value: StandardSchemaV1.InferOutput<T>): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }
    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): StandardSchemaV1.InferOutput<T> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const js =
      data.length === 0
        ? undefined
        : JSON.parse(new TextDecoder().decode(data));

    const result = this.schema["~standard"].validate(js, this.validateOptions);

    // Standard Schema validate can return a Promise, but Serde must be synchronous
    if (result && typeof result === "object" && "then" in result) {
      throw new TypeError(
        "Async validation is not supported in Serde. The schema must support synchronous validation."
      );
    }

    if (result.issues) {
      const errorMessages = result.issues
        .map((issue: StandardSchemaV1.Issue) => issue.message)
        .join(", ");
      throw new TypeError(`Standard schema validation failed: [${errorMessages}]`);
    }

    return result.value as StandardSchemaV1.InferOutput<T>;
  }
}

function isStandardJSONSchemaV1(
    standard: StandardSchemaV1.Props
): boolean {
  return (
      standard != undefined &&
      "jsonSchema" in standard &&
      typeof standard.jsonSchema === "object" &&
      standard.jsonSchema !== null &&
      "output" in standard.jsonSchema &&
      typeof standard.jsonSchema.output === "function"
  );
}

export namespace serde {
  export class JsonSerde<T> implements Serde<T | undefined> {
    contentType = "application/json";

    constructor(readonly jsonSchema?: object) {}

    serialize(value: T): Uint8Array {
      if (value === undefined) {
        return new Uint8Array(0);
      }
      return new TextEncoder().encode(JSON.stringify(value));
    }

    deserialize(data: Uint8Array): T | undefined {
      if (data.length === 0) {
        return undefined;
      }
      return JSON.parse(new TextDecoder().decode(data)) as T;
    }

    schema<U>(schema: object): Serde<U> {
      return new JsonSerde<U>(schema) as Serde<U>;
    }
  }

  export const json: JsonSerde<any> = new JsonSerde<any>();
  export const binary: Serde<Uint8Array> = new BinarySerde();
  export const empty: Serde<void> = new VoidSerde();

  /**
   * A Standard Schema-based serde.
   *
   * @param schema the standard schema
   * @param validateOptions options passed to `StandardSchemaV1.Options.libraryOptions` when validating
   * @param jsonSchemaOptions options passed to `StandardJsonSchemaV1.Options.libraryOptions` for code generation
   * @returns a serde that will validate the data with the standard schema
   */
  export const schema = <
      T extends { "~standard": StandardSchemaV1.Props },
  >(
      schema: T,
      validateOptions?: Record<string, unknown>,
      jsonSchemaOptions?: Record<string, unknown>
  ): Serde<StandardSchemaV1.InferOutput<T>> => {
    return new StandardSchemaSerde(schema, jsonSchemaOptions);
  };
}
