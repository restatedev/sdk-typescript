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

/**
 * A custom serde that encodes values as a magic prefix followed by JSON
 * bytes. Because it implements `preview`, the Restate server (and anything
 * hitting the SDK directly) can round-trip values through JSON for
 * inspection and editing.
 *
 * Try it out once the service is running:
 *
 *   # encode a JSON value into the custom wire format
 *   curl -sS -X POST \
 *     -H 'content-type: application/json' \
 *     --data '{"name":"world"}' \
 *     http://localhost:9080/serdes/prefixedGreeter/encode/greet/input
 *
 *   # decode wire-format bytes back into JSON
 *   printf 'RESTATE:{"name":"world"}' | curl -sS -X POST \
 *     --data-binary @- \
 *     http://localhost:9080/serdes/prefixedGreeter/decode/greet/input
 */

import {
  handlers,
  serve,
  service,
  type Context,
} from "@restatedev/restate-sdk";
import type { Serde } from "@restatedev/restate-sdk-core";

const PREFIX = "RESTATE:";
const PREFIX_BYTES = new TextEncoder().encode(PREFIX);

function prefixedJsonSerde<T>(): Serde<T> {
  return {
    contentType: "application/x-restate-prefixed+json",

    serialize(value: T): Uint8Array {
      const body = new TextEncoder().encode(JSON.stringify(value));
      const out = new Uint8Array(PREFIX_BYTES.length + body.length);
      out.set(PREFIX_BYTES, 0);
      out.set(body, PREFIX_BYTES.length);
      return out;
    },

    deserialize(data: Uint8Array): T {
      for (let i = 0; i < PREFIX_BYTES.length; i++) {
        if (data[i] !== PREFIX_BYTES[i]) {
          throw new Error(`Missing '${PREFIX}' prefix`);
        }
      }
      const json = new TextDecoder().decode(data.subarray(PREFIX_BYTES.length));
      return JSON.parse(json) as T;
    },

    // `preview` lets tooling render values as JSON for humans, and accept
    // JSON edits back into the serde's native format. The service exposes
    // this capability via discovery metadata
    // (`restate.serde.preview.greet/input = "true"`) and via HTTP at
    // `/serdes/<service>/(encode|decode)/<serdeName>`.
    preview: {
      toJsonString(value: T): string {
        return JSON.stringify(value, null, 2);
      },
      fromJsonString(json: string): T {
        return JSON.parse(json) as T;
      },
    },
  };
}

type Greeting = { name: string };
type Reply = { greeting: string };

const greeter = service({
  name: "prefixedGreeter",
  handlers: {
    greet: handlers.handler(
      {
        input: prefixedJsonSerde<Greeting>(),
        output: prefixedJsonSerde<Reply>(),
      },
      async (_ctx: Context, req: Greeting): Promise<Reply> => {
        return { greeting: `Hello, ${req.name}!` };
      }
    ),
  },
});

export type PrefixedGreeter = typeof greeter;

serve({ services: [greeter] });
