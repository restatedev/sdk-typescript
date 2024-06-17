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

import { streamDecoder } from "../src/io/decoder";
import { Message } from "../src/types/types";
import { backgroundInvokeMessage } from "./protoutils";
import { encodeMessage } from "../src/io/encoder";
import { describe, expect, it } from "vitest";

describe("The stream decoder", () => {
  it("should handle decoding of messages across chunks", () => {
    const largeMessage = backgroundInvokeMessage(
      "test",
      "test",
      Buffer.alloc(2048)
    );
    const largeMessageBytes = encodeMessage(largeMessage);

    const result: Message[] = [];

    const decoder = streamDecoder();
    decoder.push = (chunk: Message) => {
      result.push(chunk);
      return true;
    };

    let callbackCounter = 0;
    const cb = () => {
      callbackCounter++;
    };

    decoder._transform(largeMessageBytes.slice(0, 122), "binary", cb);
    decoder._transform(largeMessageBytes.slice(122), "binary", cb);

    expect(result.length).toStrictEqual(1);
    expect(result[0]).toStrictEqual(largeMessage);
    expect(callbackCounter).toStrictEqual(2);
  });
});
