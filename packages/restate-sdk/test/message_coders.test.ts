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

import { streamDecoder } from "../src/io/decoder.js";
import type { Message } from "../src/types/types.js";
import { backgroundInvokeMessage } from "./protoutils.js";
import { encodeMessage } from "../src/io/encoder.js";
import { describe, expect, it } from "vitest";

describe("The stream decoder", () => {
  it("should handle decoding of messages across chunks", async () => {
    const largeMessage = backgroundInvokeMessage(
      "test",
      "test",
      Buffer.alloc(2048)
    );
    const largeMessageBytes = encodeMessage(largeMessage);

    const result: Message[] = [];

    const decoder = streamDecoder();

    const resultPromise = (async () => {
      for await (const chunk of decoder.readable) {
        result.push(chunk);
      }
    })();

    const writer = decoder.writable.getWriter();
    await writer.write(largeMessageBytes.slice(0, 122));
    await writer.write(largeMessageBytes.slice(122));
    await writer.close();
    await resultPromise;

    expect(result.length).toStrictEqual(1);
    expect(result[0]).toStrictEqual(largeMessage);
  });
});
