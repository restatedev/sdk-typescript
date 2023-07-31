"use strict";

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
