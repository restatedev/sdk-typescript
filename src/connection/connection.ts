"use strict";

import { Message } from "../types/types";

export interface Connection {
  addOnErrorListener(listener: () => void): void;

  send(msg: Message): void;

  onMessage(handler: (msg: Message) => void): void;

  onClose(handler: () => void): void;

  end(): void;
}
