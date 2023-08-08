import { describe, expect } from "@jest/globals";
import { streamDecoder } from "../src/io/decoder";
import { Message } from "../src/types/types";
import { backgroundInvokeMessage } from "./protoutils";
import { encodeMessage } from "../src/io/encoder";

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
});
