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

export interface Serde<T> {
  readonly contentType: string;

  serialize(value: T): Uint8Array;

  deserialize(data: Uint8Array): T;
}

class JsonSerde<T> implements Serde<T | undefined> {
  contentType = "application/json";

  serialize(value: T): Uint8Array {
    if (value == undefined) {
      return new Uint8Array(0);
    }
    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): T | undefined {
    if (data.length == 0) {
      return undefined;
    }
    return JSON.parse(new TextDecoder().decode(data)) as T;
  }
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
  contentType = "application/octet-stream";

  serialize(value: any): Uint8Array {
    if (value !== undefined) {
      throw new Error("Expected undefined value");
    }
    return new Uint8Array(0);
  }

  deserialize(data: Uint8Array): void {
    if (data.length != 0) {
      throw new Error("Expected empty data");
    }
  }
}

export namespace serde {
  export const json: Serde<any> = new JsonSerde<any>();
  export const binary: Serde<Uint8Array> = new BinarySerde();
  export const empty: Serde<void> = new VoidSerde();
}
