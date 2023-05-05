"use strict";

import { ProtocolMessage } from "../types/protocol";
import { RestateDuplexStreamEventHandler } from "./restate_duplex_stream";

export interface Connection {
  addOnErrorListener(listener: () => void): void;

  send(
    messageType: bigint,
    message: ProtocolMessage | Uint8Array,
    completed?: boolean | undefined,
    requiresAck?: boolean | undefined
  ): void;

  onMessage(handler: RestateDuplexStreamEventHandler): void;

  onClose(handler: () => void): void;

  end(): void;
}