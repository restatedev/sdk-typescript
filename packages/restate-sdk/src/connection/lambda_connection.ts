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

import { Connection } from "./connection";
import { encodeMessage } from "../io/encoder";
import {
  ERROR_MESSAGE_TYPE,
  OUTPUT_ENTRY_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
} from "../types/protocol";
import { Message } from "../types/types";
import { rlog } from "../logger";
import { Buffer } from "node:buffer";

const RESOLVED: Promise<void> = Promise.resolve();

export class LambdaConnection implements Connection {
  // Empty buffer to store journal output messages
  private outputBuffer: Buffer = Buffer.alloc(0);

  // Callback to resolve the invocation promise of the Lambda handler when the response is ready
  private readonly completionPromise: Promise<Buffer>;
  private resolveOnCompleted!: (value: Buffer | PromiseLike<Buffer>) => void;

  constructor(private suspendedOrCompleted = false) {
    // Promise that signals when the invocation is over, to then flush the messages
    this.completionPromise = new Promise<Buffer>((resolve) => {
      this.resolveOnCompleted = resolve;
    });
  }

  // Send a message back to the runtime
  send(msg: Message): Promise<void> {
    // Add the header and the body to buffer and add to the output buffer
    const msgBuffer = encodeMessage(msg);
    this.outputBuffer = Buffer.concat([this.outputBuffer, msgBuffer]);

    // An output message, suspension message or error message is the end of a Lambda invocation
    if (
      msg.messageType === OUTPUT_ENTRY_MESSAGE_TYPE ||
      msg.messageType === SUSPENSION_MESSAGE_TYPE ||
      msg.messageType === ERROR_MESSAGE_TYPE
    ) {
      this.suspendedOrCompleted = true;
    }

    return RESOLVED;
  }

  getResult(): Promise<Buffer> {
    return this.completionPromise;
  }

  end(): Promise<void> {
    if (this.suspendedOrCompleted) {
      rlog.debug("Flushing output buffer...");
      this.resolveOnCompleted(this.outputBuffer);
    }
    this.outputBuffer = Buffer.alloc(0);
    return RESOLVED;
  }
}
