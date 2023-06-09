"use strict";

import { Message } from "../types/types";

export interface Connection {
  buffer(msg: Message): void;

  flush(): Promise<void>;

  onMessage(handler: (msg: Message) => void): void;

  onClose(handler: () => void): void;

  onError(listener: () => void): void;

  end(): void;
}
