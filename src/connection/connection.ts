/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { Message } from "../types/types";

/**
 * A connection from the service/SDK to Restate.
 * Accepts messages to be sent and committed to the journal.
 */
export interface Connection {
  send(msg: Message): Promise<void>;

  end(): Promise<void>;
}

/**
 * A consumer of a message stream from Restate.
 * Messages include journal replay messages and completion messages.
 */
export interface RestateStreamConsumer {
  handleMessage(m: Message): boolean;

  handleStreamError(e: Error): void;

  handleInputClosed(): void;
}
