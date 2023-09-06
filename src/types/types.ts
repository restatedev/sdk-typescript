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

import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  KNOWN_MESSAGE_TYPES,
  POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE,
  ProtocolMessage,
  SLEEP_ENTRY_MESSAGE_TYPE,
  START_MESSAGE_TYPE,
} from "./protocol";

export class Message {
  constructor(
    readonly messageType: bigint,
    readonly message: ProtocolMessage,
    readonly completed?: boolean,
    readonly protocolVersion?: number,
    readonly requiresAck?: boolean
  ) {}
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
      messageType === POLL_INPUT_STREAM_ENTRY_MESSAGE_TYPE ||
      messageType === GET_STATE_ENTRY_MESSAGE_TYPE ||
      messageType === SLEEP_ENTRY_MESSAGE_TYPE ||
      messageType === AWAKEABLE_ENTRY_MESSAGE_TYPE
    );
  }

  static hasProtocolVersion(messageType: bigint): boolean {
    return messageType == START_MESSAGE_TYPE;
  }

  static isCustom(messageTypeId: bigint): boolean {
    return !KNOWN_MESSAGE_TYPES.has(messageTypeId);
  }

  static hasRequiresAckFlag(messageTypeId: bigint): boolean {
    return this.isCustom(messageTypeId);
  }
}

const CUSTOM_MESSAGE_MASK = BigInt(0xfc00);
const COMPLETED_MASK = BigInt(0x0001_0000_0000);
const VERSION_MASK = BigInt(0x03ff_0000_0000);
const REQUIRES_ACK_MASK = BigInt(0x0001_0000_0000);

// The header is exported but only for tests.
export class Header {
  constructor(
    readonly messageType: bigint,
    readonly frameLength: number,
    readonly completedFlag?: boolean,
    readonly protocolVersion?: number,
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
    const protocolVersion = MessageType.hasProtocolVersion(messageType)
      ? Number(((value & VERSION_MASK) >> 32n) & 0xffffn)
      : undefined;
    const requiresAckFlag =
      MessageType.hasRequiresAckFlag(messageType) &&
      (value & REQUIRES_ACK_MASK) !== 0n
        ? true
        : undefined;
    const frameLength = Number(value & 0xffffffffn);

    return new Header(
      messageType,
      frameLength,
      completedFlag,
      protocolVersion,
      requiresAckFlag
    );
  }

  public toU64be(): bigint {
    let res = (this.messageType << 48n) | BigInt(this.frameLength);
    if (this.completedFlag) {
      res = res | COMPLETED_MASK;
    }
    if (this.protocolVersion !== undefined) {
      res = res | (BigInt(this.protocolVersion) << 32n);
    }
    if (this.requiresAckFlag) {
      res = res | REQUIRES_ACK_MASK;
    }
    return res;
  }
}
