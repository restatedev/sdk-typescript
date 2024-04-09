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

import { describe, expect } from "@jest/globals";
import {
  decodeMessagesBuffer,
  streamDecoder,
  SUPPORTED_PROTOCOL_VERSION,
} from "../src/io/decoder";
import { Message } from "../src/types/types";
import { backgroundInvokeMessage } from "./protoutils";
import { encodeMessage } from "../src/io/encoder";
import { START_MESSAGE_TYPE, StartMessage } from "../src/types/protocol";

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
    decoder.push = (chunk) => {
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

  it("should fail when unsupported protocol version", () => {
    const startMessage = encodeMessage(
      new Message(
        START_MESSAGE_TYPE,
        new StartMessage({
          id: Buffer.from(
            "f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2",
            "hex"
          ),
          debugId: "8xHx_cuYY_AAYvTQA7NfWm1RyBOd2IYsg",
        }),
        undefined,
        SUPPORTED_PROTOCOL_VERSION + 1,
        undefined
      )
    );

    expect(() => decodeMessagesBuffer(Buffer.from(startMessage))).toThrow(
      "Unsupported protocol version"
    );
  });
});
