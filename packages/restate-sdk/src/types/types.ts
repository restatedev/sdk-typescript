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

import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  COMPLETION_MESSAGE_TYPE,
  ENTRY_ACK_MESSAGE_TYPE,
  ERROR_MESSAGE_TYPE,
  formatMessageType,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  GET_STATE_KEYS_ENTRY_MESSAGE_TYPE,
  KNOWN_MESSAGE_TYPES,
  PROTOBUF_MESSAGE_BY_TYPE,
  type ProtocolMessage,
  SLEEP_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
  SUSPENSION_MESSAGE_TYPE,
} from "./protocol";

export class Message {
  constructor(
    readonly messageType: bigint,
    readonly message: ProtocolMessage,
    readonly completed?: boolean,
    readonly requiresAck?: boolean
  ) {}

  // For debugging purposes
  toJSON(): unknown {
    const pbType = PROTOBUF_MESSAGE_BY_TYPE.get(this.messageType);
    if (pbType === undefined) {
      return this;
    }
    return {
      messageType: formatMessageType(this.messageType),
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: this.message.toJson(),
    };
  }
}

class MessageType {
  static assertValid(messageTypeId: bigint) {
    if (KNOWN_MESSAGE_TYPES.has(messageTypeId)) {
      return;
    }
    if ((messageTypeId & CUSTOM_MESSAGE_MASK) !== 0n) {
      return;
    }
    throw new Error(`Unknown message type ${messageTypeId}`);
  }

  static hasCompletedFlag(messageType: bigint): boolean {
    return (
      messageType === GET_STATE_ENTRY_MESSAGE_TYPE ||
      messageType === GET_STATE_KEYS_ENTRY_MESSAGE_TYPE ||
      messageType === SLEEP_ENTRY_MESSAGE_TYPE ||
      messageType === AWAKEABLE_ENTRY_MESSAGE_TYPE
    );
  }

  static hasProtocolVersion(messageType: bigint): boolean {
    return messageType == START_MESSAGE_TYPE;
  }

  static hasRequiresAckFlag(messageType: bigint): boolean {
    return (
      messageType !== START_MESSAGE_TYPE &&
      messageType !== ERROR_MESSAGE_TYPE &&
      messageType !== SUSPENSION_MESSAGE_TYPE &&
      messageType !== ENTRY_ACK_MESSAGE_TYPE &&
      messageType !== COMPLETION_MESSAGE_TYPE
    );
  }
}

const CUSTOM_MESSAGE_MASK = BigInt(0xfc00);
const COMPLETED_MASK = BigInt(0x0001_0000_0000);
const REQUIRES_ACK_MASK = BigInt(0x8000_0000_0000);

// The header is exported but only for tests.
export class Header {
  constructor(
    readonly messageType: bigint,
    readonly frameLength: number,
    readonly completedFlag?: boolean,
    readonly requiresAckFlag?: boolean,
    readonly partialStateFlag?: boolean
  ) {}

  public static fromU64be(value: bigint): Header {
    const messageType: bigint = (value >> 48n) & 0xffffn;
    MessageType.assertValid(messageType);

    const completedFlag =
      MessageType.hasCompletedFlag(messageType) &&
      (value & COMPLETED_MASK) !== 0n
        ? true
        : undefined;
    const requiresAckFlag =
      MessageType.hasRequiresAckFlag(messageType) &&
      (value & REQUIRES_ACK_MASK) !== 0n
        ? true
        : undefined;
    const frameLength = Number(value & 0xffffffffn);

    return new Header(messageType, frameLength, completedFlag, requiresAckFlag);
  }

  public toU64be(): bigint {
    let res = (this.messageType << 48n) | BigInt(this.frameLength);
    if (this.completedFlag) {
      res = res | COMPLETED_MASK;
    }
    if (this.requiresAckFlag) {
      res = res | REQUIRES_ACK_MASK;
    }
    return res;
  }
}
