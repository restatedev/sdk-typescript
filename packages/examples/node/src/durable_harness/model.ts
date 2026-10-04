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

// A faux streaming model, deterministic on the transcript:
// * "use tools a,b" -> calls the tools a and b
// * after tool results -> summarizes them
// * anything else -> echoes the input

import { crashpoint } from "./crash.js";
import type { Message, ToolCall } from "./types.js";

export type ModelResponse = {
  content: string;
  toolCalls?: ToolCall[];
};

export async function streamModel(
  messages: Message[],
  onPartial: (partial: string) => void
): Promise<ModelResponse> {
  const last = messages[messages.length - 1];
  let response: ModelResponse;
  if (last?.role === "toolResult") {
    const results = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== "toolResult") break;
      results.unshift(`${m.tool}: ${m.content}`);
    }
    response = { content: `Tool results: ${results.join("; ")}` };
  } else if (last?.role === "user" && last.content.startsWith("use tools ")) {
    const names = last.content.slice("use tools ".length).split(",");
    response = {
      content: `Calling ${names.join(" and ")}`,
      toolCalls: names.map((name, i) => ({
        id: `call-${messages.length}-${i}`,
        name: name.trim(),
        args: { item: "apple" },
      })),
    };
  } else {
    response = {
      content: `You said: ${last?.role === "user" ? last.content : "?"}`,
    };
  }

  // Stream the content word by word
  const words = response.content.split(" ");
  let partial = "";
  for (const [i, word] of words.entries()) {
    partial += (i === 0 ? "" : " ") + word;
    onPartial(partial);
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (i === Math.floor(words.length / 2)) {
      crashpoint("stream");
    }
  }
  return response;
}
