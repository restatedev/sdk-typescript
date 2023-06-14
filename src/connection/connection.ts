"use strict";

import { Message } from "../types/types";

export interface Connection {
  buffer(msg: Message): void;

  flush(): Promise<void>;

  onClose(handler: () => void): void;

  onError(listener: (e: Error) => void): void;

  end(): void;
}
