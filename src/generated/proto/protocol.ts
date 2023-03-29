/* eslint-disable */
import Long from "long";
import _m0 from "protobufjs/minimal";
import { FileDescriptorProto as FileDescriptorProto1 } from "ts-proto-descriptors";
import { Empty, protoMetadata as protoMetadata1 } from "../google/protobuf/empty";

export const protobufPackage = "dev.restate.service.protocol";

/** Type: 0x0000 + 0 */
export interface StartMessage {
  invocationId: Buffer;
  instanceKey: Buffer;
  knownEntries: number;
}

/**
 * Type: 0x0000 + 1
 * Note: Completions that are simply acks will use this frame without sending back any result
 */
export interface CompletionMessage {
  entryIndex: number;
  empty?: Empty | undefined;
  value?: Buffer | undefined;
  failure?: Failure | undefined;
}

/**
 * Type: 0x0000 + 2
 * Implementations MUST send this message when suspending an invocation.
 */
export interface SuspensionMessage {
  /**
   * This list represents any of the entry_index the invocation is waiting on to progress.
   * The runtime will resume the invocation as soon as one of the given entry_index is completed.
   * This list MUST not be empty.
   * False positive, entry_indexes is a valid plural of entry_indices.
   * https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/i/index-indexes-indices
   */
  entryIndexes: number[];
}

/**
 * Kind: Completable JournalEntry
 * Type: 0x0400 + 0
 */
export interface PollInputStreamEntryMessage {
  value: Buffer;
}

/**
 * Kind: Ack-able JournalEntry
 * Type: 0x0400 + 1
 */
export interface OutputStreamEntryMessage {
  value?: Buffer | undefined;
  failure?: Failure | undefined;
}

/**
 * Kind: Completable JournalEntry
 * Type: 0x0800 + 0
 */
export interface GetStateEntryMessage {
  key: Buffer;
  empty?: Empty | undefined;
  value?: Buffer | undefined;
}

/**
 * Kind: Ack-able JournalEntry
 * Type: 0x0800 + 1
 */
export interface SetStateEntryMessage {
  key: Buffer;
  value: Buffer;
}

/**
 * Kind: Ack-able JournalEntry
 * Type: 0x0800 + 2
 */
export interface ClearStateEntryMessage {
  key: Buffer;
}

/**
 * Kind: Completable JournalEntry
 * Type: 0x0C00 + 0
 */
export interface SleepEntryMessage {
  /** Duration since UNIX Epoch */
  wakeUpTime: number;
  result: Empty | undefined;
}

/**
 * Kind: Completable JournalEntry
 * Type: 0x0C00 + 1
 */
export interface InvokeEntryMessage {
  serviceName: string;
  methodName: string;
  parameter: Buffer;
  value?: Buffer | undefined;
  failure?: Failure | undefined;
}

/**
 * Kind: Ack-able JournalEntry
 * Type: 0x0C00 + 2
 */
export interface BackgroundInvokeEntryMessage {
  serviceName: string;
  methodName: string;
  parameter: Buffer;
}

/**
 * Kind: Completable JournalEntry
 * Type: 0x0C00 + 3
 */
export interface AwakeableEntryMessage {
  value?: Buffer | undefined;
  failure?: Failure | undefined;
}

/**
 * Kind: Ack-able JournalEntry
 * Type: 0x0C00 + 4
 */
export interface CompleteAwakeableEntryMessage {
  serviceName: string;
  instanceKey: Buffer;
  invocationId: Buffer;
  entryIndex: number;
  payload: Buffer;
}

export interface Failure {
  code: number;
  message: string;
}

function createBaseStartMessage(): StartMessage {
  return { invocationId: Buffer.alloc(0), instanceKey: Buffer.alloc(0), knownEntries: 0 };
}

export const StartMessage = {
  encode(message: StartMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.invocationId.length !== 0) {
      writer.uint32(10).bytes(message.invocationId);
    }
    if (message.instanceKey.length !== 0) {
      writer.uint32(18).bytes(message.instanceKey);
    }
    if (message.knownEntries !== 0) {
      writer.uint32(24).uint32(message.knownEntries);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StartMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStartMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.invocationId = reader.bytes() as Buffer;
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.instanceKey = reader.bytes() as Buffer;
          continue;
        case 3:
          if (tag != 24) {
            break;
          }

          message.knownEntries = reader.uint32();
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): StartMessage {
    return {
      invocationId: isSet(object.invocationId) ? Buffer.from(bytesFromBase64(object.invocationId)) : Buffer.alloc(0),
      instanceKey: isSet(object.instanceKey) ? Buffer.from(bytesFromBase64(object.instanceKey)) : Buffer.alloc(0),
      knownEntries: isSet(object.knownEntries) ? Number(object.knownEntries) : 0,
    };
  },

  toJSON(message: StartMessage): unknown {
    const obj: any = {};
    message.invocationId !== undefined &&
      (obj.invocationId = base64FromBytes(message.invocationId !== undefined ? message.invocationId : Buffer.alloc(0)));
    message.instanceKey !== undefined &&
      (obj.instanceKey = base64FromBytes(message.instanceKey !== undefined ? message.instanceKey : Buffer.alloc(0)));
    message.knownEntries !== undefined && (obj.knownEntries = Math.round(message.knownEntries));
    return obj;
  },

  create(base?: DeepPartial<StartMessage>): StartMessage {
    return StartMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<StartMessage>): StartMessage {
    const message = createBaseStartMessage();
    message.invocationId = object.invocationId ?? Buffer.alloc(0);
    message.instanceKey = object.instanceKey ?? Buffer.alloc(0);
    message.knownEntries = object.knownEntries ?? 0;
    return message;
  },
};

function createBaseCompletionMessage(): CompletionMessage {
  return { entryIndex: 0, empty: undefined, value: undefined, failure: undefined };
}

export const CompletionMessage = {
  encode(message: CompletionMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.entryIndex !== 0) {
      writer.uint32(8).uint32(message.entryIndex);
    }
    if (message.empty !== undefined) {
      Empty.encode(message.empty, writer.uint32(106).fork()).ldelim();
    }
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    if (message.failure !== undefined) {
      Failure.encode(message.failure, writer.uint32(122).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): CompletionMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCompletionMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 8) {
            break;
          }

          message.entryIndex = reader.uint32();
          continue;
        case 13:
          if (tag != 106) {
            break;
          }

          message.empty = Empty.decode(reader, reader.uint32());
          continue;
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
        case 15:
          if (tag != 122) {
            break;
          }

          message.failure = Failure.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): CompletionMessage {
    return {
      entryIndex: isSet(object.entryIndex) ? Number(object.entryIndex) : 0,
      empty: isSet(object.empty) ? Empty.fromJSON(object.empty) : undefined,
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
      failure: isSet(object.failure) ? Failure.fromJSON(object.failure) : undefined,
    };
  },

  toJSON(message: CompletionMessage): unknown {
    const obj: any = {};
    message.entryIndex !== undefined && (obj.entryIndex = Math.round(message.entryIndex));
    message.empty !== undefined && (obj.empty = message.empty ? Empty.toJSON(message.empty) : undefined);
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    message.failure !== undefined && (obj.failure = message.failure ? Failure.toJSON(message.failure) : undefined);
    return obj;
  },

  create(base?: DeepPartial<CompletionMessage>): CompletionMessage {
    return CompletionMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<CompletionMessage>): CompletionMessage {
    const message = createBaseCompletionMessage();
    message.entryIndex = object.entryIndex ?? 0;
    message.empty = (object.empty !== undefined && object.empty !== null) ? Empty.fromPartial(object.empty) : undefined;
    message.value = object.value ?? undefined;
    message.failure = (object.failure !== undefined && object.failure !== null)
      ? Failure.fromPartial(object.failure)
      : undefined;
    return message;
  },
};

function createBaseSuspensionMessage(): SuspensionMessage {
  return { entryIndexes: [] };
}

export const SuspensionMessage = {
  encode(message: SuspensionMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writer.uint32(10).fork();
    for (const v of message.entryIndexes) {
      writer.uint32(v);
    }
    writer.ldelim();
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SuspensionMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSuspensionMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag == 8) {
            message.entryIndexes.push(reader.uint32());
            continue;
          }

          if (tag == 10) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.entryIndexes.push(reader.uint32());
            }

            continue;
          }

          break;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SuspensionMessage {
    return { entryIndexes: Array.isArray(object?.entryIndexes) ? object.entryIndexes.map((e: any) => Number(e)) : [] };
  },

  toJSON(message: SuspensionMessage): unknown {
    const obj: any = {};
    if (message.entryIndexes) {
      obj.entryIndexes = message.entryIndexes.map((e) => Math.round(e));
    } else {
      obj.entryIndexes = [];
    }
    return obj;
  },

  create(base?: DeepPartial<SuspensionMessage>): SuspensionMessage {
    return SuspensionMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SuspensionMessage>): SuspensionMessage {
    const message = createBaseSuspensionMessage();
    message.entryIndexes = object.entryIndexes?.map((e) => e) || [];
    return message;
  },
};

function createBasePollInputStreamEntryMessage(): PollInputStreamEntryMessage {
  return { value: Buffer.alloc(0) };
}

export const PollInputStreamEntryMessage = {
  encode(message: PollInputStreamEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.value.length !== 0) {
      writer.uint32(114).bytes(message.value);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PollInputStreamEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePollInputStreamEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): PollInputStreamEntryMessage {
    return { value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : Buffer.alloc(0) };
  },

  toJSON(message: PollInputStreamEntryMessage): unknown {
    const obj: any = {};
    message.value !== undefined &&
      (obj.value = base64FromBytes(message.value !== undefined ? message.value : Buffer.alloc(0)));
    return obj;
  },

  create(base?: DeepPartial<PollInputStreamEntryMessage>): PollInputStreamEntryMessage {
    return PollInputStreamEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<PollInputStreamEntryMessage>): PollInputStreamEntryMessage {
    const message = createBasePollInputStreamEntryMessage();
    message.value = object.value ?? Buffer.alloc(0);
    return message;
  },
};

function createBaseOutputStreamEntryMessage(): OutputStreamEntryMessage {
  return { value: undefined, failure: undefined };
}

export const OutputStreamEntryMessage = {
  encode(message: OutputStreamEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    if (message.failure !== undefined) {
      Failure.encode(message.failure, writer.uint32(122).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): OutputStreamEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOutputStreamEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
        case 15:
          if (tag != 122) {
            break;
          }

          message.failure = Failure.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): OutputStreamEntryMessage {
    return {
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
      failure: isSet(object.failure) ? Failure.fromJSON(object.failure) : undefined,
    };
  },

  toJSON(message: OutputStreamEntryMessage): unknown {
    const obj: any = {};
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    message.failure !== undefined && (obj.failure = message.failure ? Failure.toJSON(message.failure) : undefined);
    return obj;
  },

  create(base?: DeepPartial<OutputStreamEntryMessage>): OutputStreamEntryMessage {
    return OutputStreamEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<OutputStreamEntryMessage>): OutputStreamEntryMessage {
    const message = createBaseOutputStreamEntryMessage();
    message.value = object.value ?? undefined;
    message.failure = (object.failure !== undefined && object.failure !== null)
      ? Failure.fromPartial(object.failure)
      : undefined;
    return message;
  },
};

function createBaseGetStateEntryMessage(): GetStateEntryMessage {
  return { key: Buffer.alloc(0), empty: undefined, value: undefined };
}

export const GetStateEntryMessage = {
  encode(message: GetStateEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.key.length !== 0) {
      writer.uint32(10).bytes(message.key);
    }
    if (message.empty !== undefined) {
      Empty.encode(message.empty, writer.uint32(106).fork()).ldelim();
    }
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetStateEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetStateEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.key = reader.bytes() as Buffer;
          continue;
        case 13:
          if (tag != 106) {
            break;
          }

          message.empty = Empty.decode(reader, reader.uint32());
          continue;
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): GetStateEntryMessage {
    return {
      key: isSet(object.key) ? Buffer.from(bytesFromBase64(object.key)) : Buffer.alloc(0),
      empty: isSet(object.empty) ? Empty.fromJSON(object.empty) : undefined,
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
    };
  },

  toJSON(message: GetStateEntryMessage): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = base64FromBytes(message.key !== undefined ? message.key : Buffer.alloc(0)));
    message.empty !== undefined && (obj.empty = message.empty ? Empty.toJSON(message.empty) : undefined);
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    return obj;
  },

  create(base?: DeepPartial<GetStateEntryMessage>): GetStateEntryMessage {
    return GetStateEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GetStateEntryMessage>): GetStateEntryMessage {
    const message = createBaseGetStateEntryMessage();
    message.key = object.key ?? Buffer.alloc(0);
    message.empty = (object.empty !== undefined && object.empty !== null) ? Empty.fromPartial(object.empty) : undefined;
    message.value = object.value ?? undefined;
    return message;
  },
};

function createBaseSetStateEntryMessage(): SetStateEntryMessage {
  return { key: Buffer.alloc(0), value: Buffer.alloc(0) };
}

export const SetStateEntryMessage = {
  encode(message: SetStateEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.key.length !== 0) {
      writer.uint32(10).bytes(message.key);
    }
    if (message.value.length !== 0) {
      writer.uint32(26).bytes(message.value);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SetStateEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSetStateEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.key = reader.bytes() as Buffer;
          continue;
        case 3:
          if (tag != 26) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SetStateEntryMessage {
    return {
      key: isSet(object.key) ? Buffer.from(bytesFromBase64(object.key)) : Buffer.alloc(0),
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : Buffer.alloc(0),
    };
  },

  toJSON(message: SetStateEntryMessage): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = base64FromBytes(message.key !== undefined ? message.key : Buffer.alloc(0)));
    message.value !== undefined &&
      (obj.value = base64FromBytes(message.value !== undefined ? message.value : Buffer.alloc(0)));
    return obj;
  },

  create(base?: DeepPartial<SetStateEntryMessage>): SetStateEntryMessage {
    return SetStateEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SetStateEntryMessage>): SetStateEntryMessage {
    const message = createBaseSetStateEntryMessage();
    message.key = object.key ?? Buffer.alloc(0);
    message.value = object.value ?? Buffer.alloc(0);
    return message;
  },
};

function createBaseClearStateEntryMessage(): ClearStateEntryMessage {
  return { key: Buffer.alloc(0) };
}

export const ClearStateEntryMessage = {
  encode(message: ClearStateEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.key.length !== 0) {
      writer.uint32(10).bytes(message.key);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ClearStateEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClearStateEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.key = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): ClearStateEntryMessage {
    return { key: isSet(object.key) ? Buffer.from(bytesFromBase64(object.key)) : Buffer.alloc(0) };
  },

  toJSON(message: ClearStateEntryMessage): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = base64FromBytes(message.key !== undefined ? message.key : Buffer.alloc(0)));
    return obj;
  },

  create(base?: DeepPartial<ClearStateEntryMessage>): ClearStateEntryMessage {
    return ClearStateEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<ClearStateEntryMessage>): ClearStateEntryMessage {
    const message = createBaseClearStateEntryMessage();
    message.key = object.key ?? Buffer.alloc(0);
    return message;
  },
};

function createBaseSleepEntryMessage(): SleepEntryMessage {
  return { wakeUpTime: 0, result: undefined };
}

export const SleepEntryMessage = {
  encode(message: SleepEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.wakeUpTime !== 0) {
      writer.uint32(8).int64(message.wakeUpTime);
    }
    if (message.result !== undefined) {
      Empty.encode(message.result, writer.uint32(106).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SleepEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSleepEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 8) {
            break;
          }

          message.wakeUpTime = longToNumber(reader.int64() as Long);
          continue;
        case 13:
          if (tag != 106) {
            break;
          }

          message.result = Empty.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): SleepEntryMessage {
    return {
      wakeUpTime: isSet(object.wakeUpTime) ? Number(object.wakeUpTime) : 0,
      result: isSet(object.result) ? Empty.fromJSON(object.result) : undefined,
    };
  },

  toJSON(message: SleepEntryMessage): unknown {
    const obj: any = {};
    message.wakeUpTime !== undefined && (obj.wakeUpTime = Math.round(message.wakeUpTime));
    message.result !== undefined && (obj.result = message.result ? Empty.toJSON(message.result) : undefined);
    return obj;
  },

  create(base?: DeepPartial<SleepEntryMessage>): SleepEntryMessage {
    return SleepEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SleepEntryMessage>): SleepEntryMessage {
    const message = createBaseSleepEntryMessage();
    message.wakeUpTime = object.wakeUpTime ?? 0;
    message.result = (object.result !== undefined && object.result !== null)
      ? Empty.fromPartial(object.result)
      : undefined;
    return message;
  },
};

function createBaseInvokeEntryMessage(): InvokeEntryMessage {
  return { serviceName: "", methodName: "", parameter: Buffer.alloc(0), value: undefined, failure: undefined };
}

export const InvokeEntryMessage = {
  encode(message: InvokeEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.serviceName !== "") {
      writer.uint32(10).string(message.serviceName);
    }
    if (message.methodName !== "") {
      writer.uint32(18).string(message.methodName);
    }
    if (message.parameter.length !== 0) {
      writer.uint32(26).bytes(message.parameter);
    }
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    if (message.failure !== undefined) {
      Failure.encode(message.failure, writer.uint32(122).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): InvokeEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseInvokeEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.serviceName = reader.string();
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.methodName = reader.string();
          continue;
        case 3:
          if (tag != 26) {
            break;
          }

          message.parameter = reader.bytes() as Buffer;
          continue;
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
        case 15:
          if (tag != 122) {
            break;
          }

          message.failure = Failure.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): InvokeEntryMessage {
    return {
      serviceName: isSet(object.serviceName) ? String(object.serviceName) : "",
      methodName: isSet(object.methodName) ? String(object.methodName) : "",
      parameter: isSet(object.parameter) ? Buffer.from(bytesFromBase64(object.parameter)) : Buffer.alloc(0),
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
      failure: isSet(object.failure) ? Failure.fromJSON(object.failure) : undefined,
    };
  },

  toJSON(message: InvokeEntryMessage): unknown {
    const obj: any = {};
    message.serviceName !== undefined && (obj.serviceName = message.serviceName);
    message.methodName !== undefined && (obj.methodName = message.methodName);
    message.parameter !== undefined &&
      (obj.parameter = base64FromBytes(message.parameter !== undefined ? message.parameter : Buffer.alloc(0)));
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    message.failure !== undefined && (obj.failure = message.failure ? Failure.toJSON(message.failure) : undefined);
    return obj;
  },

  create(base?: DeepPartial<InvokeEntryMessage>): InvokeEntryMessage {
    return InvokeEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<InvokeEntryMessage>): InvokeEntryMessage {
    const message = createBaseInvokeEntryMessage();
    message.serviceName = object.serviceName ?? "";
    message.methodName = object.methodName ?? "";
    message.parameter = object.parameter ?? Buffer.alloc(0);
    message.value = object.value ?? undefined;
    message.failure = (object.failure !== undefined && object.failure !== null)
      ? Failure.fromPartial(object.failure)
      : undefined;
    return message;
  },
};

function createBaseBackgroundInvokeEntryMessage(): BackgroundInvokeEntryMessage {
  return { serviceName: "", methodName: "", parameter: Buffer.alloc(0) };
}

export const BackgroundInvokeEntryMessage = {
  encode(message: BackgroundInvokeEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.serviceName !== "") {
      writer.uint32(10).string(message.serviceName);
    }
    if (message.methodName !== "") {
      writer.uint32(18).string(message.methodName);
    }
    if (message.parameter.length !== 0) {
      writer.uint32(26).bytes(message.parameter);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): BackgroundInvokeEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBackgroundInvokeEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.serviceName = reader.string();
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.methodName = reader.string();
          continue;
        case 3:
          if (tag != 26) {
            break;
          }

          message.parameter = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): BackgroundInvokeEntryMessage {
    return {
      serviceName: isSet(object.serviceName) ? String(object.serviceName) : "",
      methodName: isSet(object.methodName) ? String(object.methodName) : "",
      parameter: isSet(object.parameter) ? Buffer.from(bytesFromBase64(object.parameter)) : Buffer.alloc(0),
    };
  },

  toJSON(message: BackgroundInvokeEntryMessage): unknown {
    const obj: any = {};
    message.serviceName !== undefined && (obj.serviceName = message.serviceName);
    message.methodName !== undefined && (obj.methodName = message.methodName);
    message.parameter !== undefined &&
      (obj.parameter = base64FromBytes(message.parameter !== undefined ? message.parameter : Buffer.alloc(0)));
    return obj;
  },

  create(base?: DeepPartial<BackgroundInvokeEntryMessage>): BackgroundInvokeEntryMessage {
    return BackgroundInvokeEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<BackgroundInvokeEntryMessage>): BackgroundInvokeEntryMessage {
    const message = createBaseBackgroundInvokeEntryMessage();
    message.serviceName = object.serviceName ?? "";
    message.methodName = object.methodName ?? "";
    message.parameter = object.parameter ?? Buffer.alloc(0);
    return message;
  },
};

function createBaseAwakeableEntryMessage(): AwakeableEntryMessage {
  return { value: undefined, failure: undefined };
}

export const AwakeableEntryMessage = {
  encode(message: AwakeableEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.value !== undefined) {
      writer.uint32(114).bytes(message.value);
    }
    if (message.failure !== undefined) {
      Failure.encode(message.failure, writer.uint32(122).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): AwakeableEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAwakeableEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 14:
          if (tag != 114) {
            break;
          }

          message.value = reader.bytes() as Buffer;
          continue;
        case 15:
          if (tag != 122) {
            break;
          }

          message.failure = Failure.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): AwakeableEntryMessage {
    return {
      value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : undefined,
      failure: isSet(object.failure) ? Failure.fromJSON(object.failure) : undefined,
    };
  },

  toJSON(message: AwakeableEntryMessage): unknown {
    const obj: any = {};
    message.value !== undefined &&
      (obj.value = message.value !== undefined ? base64FromBytes(message.value) : undefined);
    message.failure !== undefined && (obj.failure = message.failure ? Failure.toJSON(message.failure) : undefined);
    return obj;
  },

  create(base?: DeepPartial<AwakeableEntryMessage>): AwakeableEntryMessage {
    return AwakeableEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<AwakeableEntryMessage>): AwakeableEntryMessage {
    const message = createBaseAwakeableEntryMessage();
    message.value = object.value ?? undefined;
    message.failure = (object.failure !== undefined && object.failure !== null)
      ? Failure.fromPartial(object.failure)
      : undefined;
    return message;
  },
};

function createBaseCompleteAwakeableEntryMessage(): CompleteAwakeableEntryMessage {
  return {
    serviceName: "",
    instanceKey: Buffer.alloc(0),
    invocationId: Buffer.alloc(0),
    entryIndex: 0,
    payload: Buffer.alloc(0),
  };
}

export const CompleteAwakeableEntryMessage = {
  encode(message: CompleteAwakeableEntryMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.serviceName !== "") {
      writer.uint32(10).string(message.serviceName);
    }
    if (message.instanceKey.length !== 0) {
      writer.uint32(18).bytes(message.instanceKey);
    }
    if (message.invocationId.length !== 0) {
      writer.uint32(26).bytes(message.invocationId);
    }
    if (message.entryIndex !== 0) {
      writer.uint32(32).uint32(message.entryIndex);
    }
    if (message.payload.length !== 0) {
      writer.uint32(42).bytes(message.payload);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): CompleteAwakeableEntryMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCompleteAwakeableEntryMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 10) {
            break;
          }

          message.serviceName = reader.string();
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.instanceKey = reader.bytes() as Buffer;
          continue;
        case 3:
          if (tag != 26) {
            break;
          }

          message.invocationId = reader.bytes() as Buffer;
          continue;
        case 4:
          if (tag != 32) {
            break;
          }

          message.entryIndex = reader.uint32();
          continue;
        case 5:
          if (tag != 42) {
            break;
          }

          message.payload = reader.bytes() as Buffer;
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): CompleteAwakeableEntryMessage {
    return {
      serviceName: isSet(object.serviceName) ? String(object.serviceName) : "",
      instanceKey: isSet(object.instanceKey) ? Buffer.from(bytesFromBase64(object.instanceKey)) : Buffer.alloc(0),
      invocationId: isSet(object.invocationId) ? Buffer.from(bytesFromBase64(object.invocationId)) : Buffer.alloc(0),
      entryIndex: isSet(object.entryIndex) ? Number(object.entryIndex) : 0,
      payload: isSet(object.payload) ? Buffer.from(bytesFromBase64(object.payload)) : Buffer.alloc(0),
    };
  },

  toJSON(message: CompleteAwakeableEntryMessage): unknown {
    const obj: any = {};
    message.serviceName !== undefined && (obj.serviceName = message.serviceName);
    message.instanceKey !== undefined &&
      (obj.instanceKey = base64FromBytes(message.instanceKey !== undefined ? message.instanceKey : Buffer.alloc(0)));
    message.invocationId !== undefined &&
      (obj.invocationId = base64FromBytes(message.invocationId !== undefined ? message.invocationId : Buffer.alloc(0)));
    message.entryIndex !== undefined && (obj.entryIndex = Math.round(message.entryIndex));
    message.payload !== undefined &&
      (obj.payload = base64FromBytes(message.payload !== undefined ? message.payload : Buffer.alloc(0)));
    return obj;
  },

  create(base?: DeepPartial<CompleteAwakeableEntryMessage>): CompleteAwakeableEntryMessage {
    return CompleteAwakeableEntryMessage.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<CompleteAwakeableEntryMessage>): CompleteAwakeableEntryMessage {
    const message = createBaseCompleteAwakeableEntryMessage();
    message.serviceName = object.serviceName ?? "";
    message.instanceKey = object.instanceKey ?? Buffer.alloc(0);
    message.invocationId = object.invocationId ?? Buffer.alloc(0);
    message.entryIndex = object.entryIndex ?? 0;
    message.payload = object.payload ?? Buffer.alloc(0);
    return message;
  },
};

function createBaseFailure(): Failure {
  return { code: 0, message: "" };
}

export const Failure = {
  encode(message: Failure, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Failure {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseFailure();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag != 8) {
            break;
          }

          message.code = reader.int32();
          continue;
        case 2:
          if (tag != 18) {
            break;
          }

          message.message = reader.string();
          continue;
      }
      if ((tag & 7) == 4 || tag == 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): Failure {
    return {
      code: isSet(object.code) ? Number(object.code) : 0,
      message: isSet(object.message) ? String(object.message) : "",
    };
  },

  toJSON(message: Failure): unknown {
    const obj: any = {};
    message.code !== undefined && (obj.code = Math.round(message.code));
    message.message !== undefined && (obj.message = message.message);
    return obj;
  },

  create(base?: DeepPartial<Failure>): Failure {
    return Failure.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<Failure>): Failure {
    const message = createBaseFailure();
    message.code = object.code ?? 0;
    message.message = object.message ?? "";
    return message;
  },
};

type ProtoMetaMessageOptions = {
  options?: { [key: string]: any };
  fields?: { [key: string]: { [key: string]: any } };
  oneof?: { [key: string]: { [key: string]: any } };
  nested?: { [key: string]: ProtoMetaMessageOptions };
};

export interface ProtoMetadata {
  fileDescriptor: FileDescriptorProto1;
  references: { [key: string]: any };
  dependencies?: ProtoMetadata[];
  options?: {
    options?: { [key: string]: any };
    services?: {
      [key: string]: { options?: { [key: string]: any }; methods?: { [key: string]: { [key: string]: any } } };
    };
    messages?: { [key: string]: ProtoMetaMessageOptions };
    enums?: { [key: string]: { options?: { [key: string]: any }; values?: { [key: string]: { [key: string]: any } } } };
  };
}

export const protoMetadata: ProtoMetadata = {
  fileDescriptor: FileDescriptorProto1.fromPartial({
    "name": "proto/protocol.proto",
    "package": "dev.restate.service.protocol",
    "dependency": ["google/protobuf/empty.proto"],
    "publicDependency": [],
    "weakDependency": [],
    "messageType": [{
      "name": "StartMessage",
      "field": [{
        "name": "invocation_id",
        "number": 1,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "invocationId",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "instance_key",
        "number": 2,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "instanceKey",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "known_entries",
        "number": 3,
        "label": 1,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "knownEntries",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "CompletionMessage",
      "field": [{
        "name": "entry_index",
        "number": 1,
        "label": 1,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "entryIndex",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "empty",
        "number": 13,
        "label": 1,
        "type": 11,
        "typeName": ".google.protobuf.Empty",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "empty",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "failure",
        "number": 15,
        "label": 1,
        "type": 11,
        "typeName": ".dev.restate.service.protocol.Failure",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "failure",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "SuspensionMessage",
      "field": [{
        "name": "entry_indexes",
        "number": 1,
        "label": 3,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "entryIndexes",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "PollInputStreamEntryMessage",
      "field": [{
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "OutputStreamEntryMessage",
      "field": [{
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "failure",
        "number": 15,
        "label": 1,
        "type": 11,
        "typeName": ".dev.restate.service.protocol.Failure",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "failure",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "GetStateEntryMessage",
      "field": [{
        "name": "key",
        "number": 1,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "key",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "empty",
        "number": 13,
        "label": 1,
        "type": 11,
        "typeName": ".google.protobuf.Empty",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "empty",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "SetStateEntryMessage",
      "field": [{
        "name": "key",
        "number": 1,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "key",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "value",
        "number": 3,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "ClearStateEntryMessage",
      "field": [{
        "name": "key",
        "number": 1,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "key",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "SleepEntryMessage",
      "field": [{
        "name": "wake_up_time",
        "number": 1,
        "label": 1,
        "type": 3,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "wakeUpTime",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "result",
        "number": 13,
        "label": 1,
        "type": 11,
        "typeName": ".google.protobuf.Empty",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "result",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "InvokeEntryMessage",
      "field": [{
        "name": "service_name",
        "number": 1,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "serviceName",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "method_name",
        "number": 2,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "methodName",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "parameter",
        "number": 3,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "parameter",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "failure",
        "number": 15,
        "label": 1,
        "type": 11,
        "typeName": ".dev.restate.service.protocol.Failure",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "failure",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "BackgroundInvokeEntryMessage",
      "field": [{
        "name": "service_name",
        "number": 1,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "serviceName",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "method_name",
        "number": 2,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "methodName",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "parameter",
        "number": 3,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "parameter",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "AwakeableEntryMessage",
      "field": [{
        "name": "value",
        "number": 14,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "value",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "failure",
        "number": 15,
        "label": 1,
        "type": 11,
        "typeName": ".dev.restate.service.protocol.Failure",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "failure",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [{ "name": "result", "options": undefined }],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "CompleteAwakeableEntryMessage",
      "field": [{
        "name": "service_name",
        "number": 1,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "serviceName",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "instance_key",
        "number": 2,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "instanceKey",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "invocation_id",
        "number": 3,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "invocationId",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "entry_index",
        "number": 4,
        "label": 1,
        "type": 13,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "entryIndex",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "payload",
        "number": 5,
        "label": 1,
        "type": 12,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "payload",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }, {
      "name": "Failure",
      "field": [{
        "name": "code",
        "number": 1,
        "label": 1,
        "type": 5,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "code",
        "options": undefined,
        "proto3Optional": false,
      }, {
        "name": "message",
        "number": 2,
        "label": 1,
        "type": 9,
        "typeName": "",
        "extendee": "",
        "defaultValue": "",
        "oneofIndex": 0,
        "jsonName": "message",
        "options": undefined,
        "proto3Optional": false,
      }],
      "extension": [],
      "nestedType": [],
      "enumType": [],
      "extensionRange": [],
      "oneofDecl": [],
      "options": undefined,
      "reservedRange": [],
      "reservedName": [],
    }],
    "enumType": [],
    "service": [],
    "extension": [],
    "options": {
      "javaPackage": "com.dev.restate.service.protocol",
      "javaOuterClassname": "ProtocolProto",
      "javaMultipleFiles": true,
      "javaGenerateEqualsAndHash": false,
      "javaStringCheckUtf8": false,
      "optimizeFor": 1,
      "goPackage": "",
      "ccGenericServices": false,
      "javaGenericServices": false,
      "pyGenericServices": false,
      "phpGenericServices": false,
      "deprecated": false,
      "ccEnableArenas": false,
      "objcClassPrefix": "DRSP",
      "csharpNamespace": "Dev.Restate.Service.Protocol",
      "swiftPrefix": "",
      "phpClassPrefix": "",
      "phpNamespace": "Dev\\Restate\\Service\\Protocol",
      "phpMetadataNamespace": "Dev\\Restate\\Service\\Protocol\\GPBMetadata",
      "rubyPackage": "Dev::Restate::Service::Protocol",
      "uninterpretedOption": [],
    },
    "sourceCodeInfo": {
      "location": [{
        "path": [4, 0],
        "span": [9, 0, 14, 1],
        "leadingComments": " Type: 0x0000 + 0\n",
        "trailingComments": "",
        "leadingDetachedComments": [" --- Core frames ---\n"],
      }, {
        "path": [4, 1],
        "span": [18, 0, 26, 1],
        "leadingComments":
          " Type: 0x0000 + 1\n Note: Completions that are simply acks will use this frame without sending back any result\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 2],
        "span": [30, 0, 37, 1],
        "leadingComments":
          " Type: 0x0000 + 2\n Implementations MUST send this message when suspending an invocation.\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 2, 2, 0],
        "span": [36, 2, 36],
        "leadingComments":
          " This list represents any of the entry_index the invocation is waiting on to progress.\n The runtime will resume the invocation as soon as one of the given entry_index is completed.\n This list MUST not be empty.\n False positive, entry_indexes is a valid plural of entry_indices.\n https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/i/index-indexes-indices\n",
        "trailingComments": " protolint:disable:this REPEATED_FIELD_NAMES_PLURALIZED\n",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 3],
        "span": [54, 0, 56, 1],
        "leadingComments": " Kind: Completable JournalEntry\n Type: 0x0400 + 0\n",
        "trailingComments": "",
        "leadingDetachedComments": [
          " --- Journal Entries ---\n",
          " Every Completable JournalEntry has a result field, filled only and only if the entry is in DONE state.\n Depending on the semantics of the corresponding syscall, the entry can represent the result field with any of these three types:\n\n   * google.protobuf.Empty empty = 13 for cases when we need to propagate to user code the distinction between default value or no value.\n   * bytes value = 14 for carrying the result value\n   * Failure failure = 15 for carrying a failure\n\n The tag numbers 13, 14 and 15 are reserved and shouldn't be used for other fields.\n",
          " ------ Input and output ------\n",
        ],
      }, {
        "path": [4, 4],
        "span": [60, 0, 65, 1],
        "leadingComments": " Kind: Ack-able JournalEntry\n Type: 0x0400 + 1\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 5],
        "span": [71, 0, 78, 1],
        "leadingComments": " Kind: Completable JournalEntry\n Type: 0x0800 + 0\n",
        "trailingComments": "",
        "leadingDetachedComments": [" ------ State access ------\n"],
      }, {
        "path": [4, 6],
        "span": [82, 0, 85, 1],
        "leadingComments": " Kind: Ack-able JournalEntry\n Type: 0x0800 + 1\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 7],
        "span": [89, 0, 91, 1],
        "leadingComments": " Kind: Ack-able JournalEntry\n Type: 0x0800 + 2\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 8],
        "span": [97, 0, 102, 1],
        "leadingComments": " Kind: Completable JournalEntry\n Type: 0x0C00 + 0\n",
        "trailingComments": "",
        "leadingDetachedComments": [" ------ Syscalls ------\n"],
      }, {
        "path": [4, 8, 2, 0],
        "span": [99, 2, 25],
        "leadingComments": " Duration since UNIX Epoch\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 9],
        "span": [106, 0, 116, 1],
        "leadingComments": " Kind: Completable JournalEntry\n Type: 0x0C00 + 1\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 10],
        "span": [120, 0, 125, 1],
        "leadingComments": " Kind: Ack-able JournalEntry\n Type: 0x0C00 + 2\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 11],
        "span": [129, 0, 134, 1],
        "leadingComments": " Kind: Completable JournalEntry\n Type: 0x0C00 + 3\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }, {
        "path": [4, 12],
        "span": [138, 0, 145, 1],
        "leadingComments": " Kind: Ack-able JournalEntry\n Type: 0x0C00 + 4\n",
        "trailingComments": "",
        "leadingDetachedComments": [],
      }],
    },
    "syntax": "proto3",
  }),
  references: {
    ".dev.restate.service.protocol.StartMessage": StartMessage,
    ".dev.restate.service.protocol.CompletionMessage": CompletionMessage,
    ".dev.restate.service.protocol.SuspensionMessage": SuspensionMessage,
    ".dev.restate.service.protocol.PollInputStreamEntryMessage": PollInputStreamEntryMessage,
    ".dev.restate.service.protocol.OutputStreamEntryMessage": OutputStreamEntryMessage,
    ".dev.restate.service.protocol.GetStateEntryMessage": GetStateEntryMessage,
    ".dev.restate.service.protocol.SetStateEntryMessage": SetStateEntryMessage,
    ".dev.restate.service.protocol.ClearStateEntryMessage": ClearStateEntryMessage,
    ".dev.restate.service.protocol.SleepEntryMessage": SleepEntryMessage,
    ".dev.restate.service.protocol.InvokeEntryMessage": InvokeEntryMessage,
    ".dev.restate.service.protocol.BackgroundInvokeEntryMessage": BackgroundInvokeEntryMessage,
    ".dev.restate.service.protocol.AwakeableEntryMessage": AwakeableEntryMessage,
    ".dev.restate.service.protocol.CompleteAwakeableEntryMessage": CompleteAwakeableEntryMessage,
    ".dev.restate.service.protocol.Failure": Failure,
  },
  dependencies: [protoMetadata1],
};

declare var self: any | undefined;
declare var window: any | undefined;
declare var global: any | undefined;
var tsProtoGlobalThis: any = (() => {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  if (typeof self !== "undefined") {
    return self;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  throw "Unable to locate global object";
})();

function bytesFromBase64(b64: string): Uint8Array {
  if (tsProtoGlobalThis.Buffer) {
    return Uint8Array.from(tsProtoGlobalThis.Buffer.from(b64, "base64"));
  } else {
    const bin = tsProtoGlobalThis.atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  }
}

function base64FromBytes(arr: Uint8Array): string {
  if (tsProtoGlobalThis.Buffer) {
    return tsProtoGlobalThis.Buffer.from(arr).toString("base64");
  } else {
    const bin: string[] = [];
    arr.forEach((byte) => {
      bin.push(String.fromCharCode(byte));
    });
    return tsProtoGlobalThis.btoa(bin.join(""));
  }
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function longToNumber(long: Long): number {
  if (long.gt(Number.MAX_SAFE_INTEGER)) {
    throw new tsProtoGlobalThis.Error("Value is larger than Number.MAX_SAFE_INTEGER");
  }
  return long.toNumber();
}

if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
