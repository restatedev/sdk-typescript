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

/**
 * Test driver for the TypeScript shared core, mirrors `src/tests/mod.rs` of
 * `restate-sdk-shared-core`.
 */

import { expect } from "vitest";
import {
  CoreVM,
  type CoreLogger,
} from "../../src/endpoint/handlers/vm/ts/vm.js";
import {
  Decoder,
  RawMessage,
} from "../../src/endpoint/handlers/vm/ts/encoding.js";
import {
  AwaitingOnMessageDesc,
  CombinatorType,
  encodeWithHeader,
  EndMessageDesc,
  ErrorMessageDesc,
  InputCommandMessageDesc,
  MessageType,
  NotificationTemplateDesc,
  OutputCommandMessageDesc,
  ProposeRunCompletionMessageDesc,
  StartMessageDesc,
  SuspensionMessageDesc,
  VOID,
  type ErrorMessage,
  type Failure,
  type Future,
  type InputCommandMessage,
  type NotificationTemplate,
  type OutputCommandMessage,
  type StartMessage,
  type SuspensionMessage,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import {
  create,
  type MessageDesc,
} from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  defaultVMOptions,
  type AsyncResultValue,
  type VMOptions,
} from "../../src/endpoint/handlers/vm/ts/types.js";
import { codes, VMError } from "../../src/endpoint/handlers/vm/ts/errors.js";
import {
  MAXIMUM_SUPPORTED_VERSION,
  Version,
  versionContentType,
} from "../../src/endpoint/handlers/vm/ts/version.js";
import { LogLevel } from "../../src/endpoint/handlers/vm/types.js";

export const b = (s: string): Uint8Array => new TextEncoder().encode(s);
export const str = (u: Uint8Array): string => new TextDecoder().decode(u);

export const TEST_LOGGER: CoreLogger = {
  enabled: (level) => level >= LogLevel.WARN,
  log: () => {},
};

/** A message ready to be fed as input: header + payload. */
export interface InputMessage {
  ty: MessageType;
  bytes: Uint8Array;
}

export function msg<T extends object>(
  ty: MessageType,
  desc: MessageDesc<T>,
  init: Partial<T> = {}
): InputMessage {
  return { ty, bytes: encodeWithHeader(ty, desc, create(desc, init)) };
}

export function mockInit(
  version: Version = MAXIMUM_SUPPORTED_VERSION,
  options: VMOptions = defaultVMOptions()
): CoreVM {
  const vm = new CoreVM(
    [{ key: "content-type", value: versionContentType(version) }],
    options,
    TEST_LOGGER
  );
  expect(vm.getResponseHead().headers).toContainEqual({
    key: "content-type",
    value: versionContentType(version),
  });
  return vm;
}

export class OutputIterator {
  private readonly decoder = new Decoder();

  constructor(vm: CoreVM) {
    for (;;) {
      const out = vm.takeOutput();
      if (out.length === 0) {
        break;
      }
      this.decoder.push(out);
    }
  }

  next(): RawMessage | undefined {
    return this.decoder.consumeNext();
  }

  nextDecoded<T extends object>(def: {
    ty: MessageType;
    desc: MessageDesc<T>;
  }): T | undefined {
    const raw = this.next();
    if (raw === undefined) {
      return undefined;
    }
    return raw.decodeTo(def, 0);
  }

  nextWithHeaderDecoded<T extends object>(def: {
    ty: MessageType;
    desc: MessageDesc<T>;
  }): { header: RawMessage["header"]; msg: T } | undefined {
    const raw = this.next();
    if (raw === undefined) {
      return undefined;
    }
    return { header: raw.header, msg: raw.decodeTo(def, 0) };
  }

  /** Asserts that there is no more output. */
  expectEnd() {
    expect(this.next()).toBeUndefined();
  }
}

export class VMTestCase {
  readonly vm: CoreVM;

  private constructor(
    readonly version: Version,
    options: VMOptions
  ) {
    this.vm = mockInit(version, options);
  }

  static new(): VMTestCase {
    return new VMTestCase(MAXIMUM_SUPPORTED_VERSION, defaultVMOptions());
  }

  static withVmOptions(options: VMOptions): VMTestCase {
    return new VMTestCase(MAXIMUM_SUPPORTED_VERSION, options);
  }

  static withVersion(version: Version): VMTestCase {
    return new VMTestCase(version, defaultVMOptions());
  }

  static withVersionAndVmOptions(
    version: Version,
    options: VMOptions
  ): VMTestCase {
    return new VMTestCase(version, options);
  }

  input(m: InputMessage): this {
    this.vm.notifyInput(m.bytes);
    return this;
  }

  run(userCode: (vm: CoreVM) => void): OutputIterator {
    this.vm.notifyInputClosed();
    expect(this.vm.isReadyToExecute()).toBe(true);

    userCode(this.vm);

    return new OutputIterator(this.vm);
  }

  runWithoutClosingInput(userCode: (vm: CoreVM) => void): OutputIterator {
    expect(this.vm.isReadyToExecute()).toBe(true);

    userCode(this.vm);

    return new OutputIterator(this.vm);
  }
}

// --- Message definitions for decoding output

export const StartMessageDef = {
  ty: MessageType.Start,
  desc: StartMessageDesc,
};
export const SuspensionMessageDef = {
  ty: MessageType.Suspension,
  desc: SuspensionMessageDesc,
};
export const ErrorMessageDef = {
  ty: MessageType.Error,
  desc: ErrorMessageDesc,
};
export const EndMessageDef = { ty: MessageType.End, desc: EndMessageDesc };
export const ProposeRunCompletionMessageDef = {
  ty: MessageType.ProposeRunCompletion,
  desc: ProposeRunCompletionMessageDesc,
};
export const AwaitingOnMessageDef = {
  ty: MessageType.AwaitingOn,
  desc: AwaitingOnMessageDesc,
};

// --- Mocks

export function startMessage(
  knownEntries: number,
  extra: Partial<StartMessage> = {}
): InputMessage {
  return msg(MessageType.Start, StartMessageDesc, {
    id: b("123"),
    debug_id: "123",
    known_entries: knownEntries,
    state_map: [],
    partial_state: true,
    key: "",
    retry_count_since_last_stored_entry: 0,
    duration_since_last_stored_entry: 0n,
    random_seed: 0n,
    ...extra,
  });
}

export function inputEntryMessage(
  input: Uint8Array | string,
  extra: Partial<InputCommandMessage> = {}
): InputMessage {
  return msg(MessageType.InputCommand, InputCommandMessageDesc, {
    headers: [],
    value: { content: typeof input === "string" ? b(input) : input },
    ...extra,
  });
}

export function notification(
  ty: MessageType,
  template: Partial<NotificationTemplate>
): InputMessage {
  return msg(ty, NotificationTemplateDesc, template);
}

export function cancelSignalNotification(): InputMessage {
  return notification(MessageType.SignalNotification, {
    signal_id: 1,
    void: VOID,
  });
}

export function emptySignalNotification(id: number): InputMessage {
  return notification(MessageType.SignalNotification, {
    signal_id: id,
    void: VOID,
  });
}

// --- Matchers / assertions

/**
 * Runs `f`; returns true if it threw the suspended error, false if it
 * completed normally. Any other error is rethrown.
 */
export function isSuspendedWhen(f: () => unknown): boolean {
  try {
    f();
    return false;
  } catch (e) {
    if (e instanceof VMError && e.isSuspendedError()) {
      return true;
    }
    throw e;
  }
}

export function expectVMError(f: () => unknown): VMError {
  try {
    f();
  } catch (e) {
    if (e instanceof VMError) {
      return e;
    }
    throw e;
  }
  throw new Error("Expected a VM error to be thrown");
}

export function expectSuspended(f: () => unknown) {
  const e = expectVMError(f);
  expect(e.isSuspendedError(), `expected suspended, got ${e.toString()}`).toBe(
    true
  );
}

export function expectClosed(f: () => unknown) {
  const e = expectVMError(f);
  expect(e.code, `expected closed, got ${e.toString()}`).toBe(codes.CLOSED);
}

export function expectSuccess(value: AsyncResultValue | undefined): Uint8Array {
  expect(value).toBeDefined();
  expect(value).toHaveProperty("Success");
  return (value as { Success: Uint8Array }).Success;
}

export function expectFailure(value: AsyncResultValue | undefined): Failure {
  expect(value).toBeDefined();
  expect(value).toHaveProperty("Failure");
  return (value as { Failure: Failure }).Failure;
}

export function expectEmpty(value: AsyncResultValue | undefined) {
  expect(value).toBe("Empty");
}

export function expectOutputWithSuccess(
  out: OutputCommandMessage | undefined,
  expected: Uint8Array | string
) {
  expect(out).toBeDefined();
  expect(out!.failure).toBeUndefined();
  expect(out!.value).toBeDefined();
  expect(str(out!.value!.content)).toBe(
    typeof expected === "string" ? expected : str(expected)
  );
}

export function expectOutputWithFailure(
  out: OutputCommandMessage | undefined,
  code: number,
  message: string
) {
  expect(out).toBeDefined();
  expect(out!.value).toBeUndefined();
  expect(out!.failure).toEqual({ code, message, metadata: [] });
}

export const OutputCommandMessageDef = {
  ty: MessageType.OutputCommand,
  desc: OutputCommandMessageDesc,
};

export function expectSuspendedWaitingCompletion(
  s: SuspensionMessage | undefined,
  completionId: number
) {
  expect(s).toBeDefined();
  expect(s!.awaiting_on).toEqual({
    waiting_completions: [completionId],
    waiting_signals: [1],
    waiting_named_signals: [],
    nested_futures: [],
    combinator_type: CombinatorType.FirstCompleted,
  } satisfies Future);
}

export function expectSuspendedWaitingSignal(
  s: SuspensionMessage | undefined,
  signalIdx: number
) {
  expect(s).toBeDefined();
  const f = s!.awaiting_on!;
  expect(f.waiting_completions).toEqual([]);
  expect(f.waiting_signals).toContain(signalIdx);
  expect(f.waiting_signals).toContain(1);
  expect(f.nested_futures).toEqual([]);
  expect(f.waiting_named_signals).toEqual([]);
  expect(f.combinator_type).toBe(CombinatorType.FirstCompleted);
}

export function expectErrorMessageAsError(
  m: ErrorMessage | undefined,
  e: VMError
) {
  expect(m).toBeDefined();
  expect(m!.code).toBe(e.code);
  expect(m!.message).toBe(e.message);
  expect(m!.stacktrace).toBe(e.stacktrace);
}

export function expectErrorMessage(
  m: ErrorMessage | undefined,
  code: number,
  messageIncludes?: string
) {
  expect(m).toBeDefined();
  expect(m!.code).toBe(code);
  if (messageIncludes !== undefined) {
    expect(m!.message).toContain(messageIncludes);
  }
}

export {
  Version,
  MAXIMUM_SUPPORTED_VERSION,
  MINIMUM_SUPPORTED_VERSION,
} from "../../src/endpoint/handlers/vm/ts/version.js";
