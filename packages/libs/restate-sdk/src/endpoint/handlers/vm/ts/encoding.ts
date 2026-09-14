/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/** Mirrors `service_protocol/encoding.rs` of the shared core. */

import { DecodingError } from "./errors.js";
import {
  decodeHeader,
  isNotificationMessageType,
  NotificationTemplateDesc,
  UnknownMessageType,
  type MessageHeader,
  type MessageType,
} from "./messages.js";
import { decodeMessage, type MessageDesc } from "./proto.js";
import {
  completionId,
  signalId,
  signalName,
  type Notification,
  type NotificationId,
  type NotificationResult,
} from "./types.js";

export class RawMessage {
  constructor(
    readonly header: MessageHeader,
    readonly payload: Uint8Array
  ) {}

  get ty(): MessageType {
    return this.header.ty;
  }

  decodeTo<T extends object>(
    def: { ty: MessageType; desc: MessageDesc<T> },
    commandIndex: number
  ): T {
    if (this.header.ty !== def.ty) {
      throw DecodingError.unexpectedMessageType(
        commandIndex,
        this.header.ty,
        def.ty
      );
    }
    try {
      return decodeMessage(def.desc, this.payload);
    } catch (e) {
      throw DecodingError.decodeMessage(this.header.ty, e);
    }
  }

  decodeAsNotification(): Notification {
    const ty = this.ty;
    if (!isNotificationMessageType(ty)) {
      throw new Error("Expected a notification");
    }
    let template;
    try {
      template = decodeMessage(NotificationTemplateDesc, this.payload);
    } catch (e) {
      throw DecodingError.decodeMessage(ty, e);
    }

    let id: NotificationId;
    if (template.completion_id !== undefined) {
      id = completionId(template.completion_id);
    } else if (template.signal_id !== undefined) {
      id = signalId(template.signal_id);
    } else if (template.signal_name !== undefined) {
      id = signalName(template.signal_name);
    } else {
      throw DecodingError.missingField(ty, "id");
    }

    let result: NotificationResult;
    if (template.void !== undefined) {
      result = { type: "void", void: template.void };
    } else if (template.value !== undefined) {
      result = { type: "value", value: template.value };
    } else if (template.failure !== undefined) {
      result = { type: "failure", failure: template.failure };
    } else if (template.invocation_id !== undefined) {
      result = { type: "invocationId", invocationId: template.invocation_id };
    } else if (template.state_keys !== undefined) {
      result = { type: "stateKeys", stateKeys: template.state_keys };
    } else {
      throw DecodingError.missingField(ty, "result");
    }

    return { id, result };
  }
}

/** Stateful decoder to decode protocol messages out of a byte stream. */
export class Decoder {
  private buf: Uint8Array = new Uint8Array(0);
  private pendingHeader: MessageHeader | undefined = undefined;

  /** Concatenate a new chunk in the internal buffer. */
  push(chunk: Uint8Array) {
    if (chunk.length === 0) {
      return;
    }
    if (this.buf.length === 0) {
      this.buf = chunk;
      return;
    }
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
  }

  /** Try to consume the next protocol message in the internal buffer. */
  consumeNext(): RawMessage | undefined {
    for (;;) {
      if (this.pendingHeader === undefined) {
        if (this.buf.length < 8) {
          return undefined;
        }
        let header;
        try {
          header = decodeHeader(this.buf, 0);
        } catch (e) {
          // Consume the header either way, like the Rust decoder, which reads
          // the u64 before converting it. Leaving it in place would make every
          // later call re-throw on the same bytes.
          this.buf = this.buf.subarray(8);
          if (e instanceof UnknownMessageType) {
            throw DecodingError.unknownMessageType(e.code);
          }
          throw e;
        }
        this.pendingHeader = header;
        this.buf = this.buf.subarray(8);
      }
      const h = this.pendingHeader;
      if (this.buf.length < h.length) {
        return undefined;
      }
      // Copy the payload out: the underlying buffer may be a large chunk we
      // don't want to retain, and on Node it is a `Buffer`, whose `slice`
      // returns a view rather than a copy.
      const payload = new Uint8Array(this.buf.subarray(0, h.length));
      this.buf = this.buf.subarray(h.length);
      this.pendingHeader = undefined;
      return new RawMessage(h, payload);
    }
  }
}
