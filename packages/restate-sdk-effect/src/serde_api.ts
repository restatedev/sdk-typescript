import type { Serde } from "@restatedev/restate-sdk-core";
import { Effect, JSONSchema, ParseResult, Schema } from "effect";

export type { Serde } from "@restatedev/restate-sdk-core";

class EffectSerde<A, I = A> implements Serde<A> {
  contentType? = "application/json";
  jsonSchema?: object | undefined;

  constructor(private readonly schema: Schema.Schema<A, I>) {
    // Generate JSON schema from Effect Schema
    this.jsonSchema = JSONSchema.make(schema);

    // Handle void/undefined types
    if (schema.Type === Schema.Void || schema.Type === Schema.Undefined) {
      this.contentType = undefined;
    }
  }

  serialize(value: A): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }

    // Encode the value using the schema
    const encoded = Schema.encode(this.schema)(value);

    // Run the effect synchronously and handle potential errors
    const result = Effect.runSync(
      Effect.catchAll(encoded, (error) =>
        Effect.die(
          new Error(
            `Serialization failed: ${ParseResult.TreeFormatter.formatErrorSync(
              error
            )}`
          )
        )
      )
    );

    return new TextEncoder().encode(JSON.stringify(result));
  }

  deserialize(data: Uint8Array): A {
    const js =
      data.length === 0
        ? undefined
        : JSON.parse(new TextDecoder().decode(data));

    // Decode the value using the schema
    const decoded = Schema.decode(this.schema)(js);

    // Run the effect and handle errors
    return Effect.runSync(
      Effect.catchAll(decoded, (error) =>
        Effect.die(
          new Error(
            `Deserialization failed: ${ParseResult.TreeFormatter.formatErrorSync(
              error
            )}`
          )
        )
      )
    );
  }
}

export namespace serde {
  /**
   * An Effect Schema based serde.
   *
   * @param schema the Effect schema
   * @returns a serde that will validate the data with the Effect schema
   */
  export const effect = <A, I = A>(schema: Schema.Schema<A, I>): Serde<A> => {
    return new EffectSerde(schema);
  };
}
