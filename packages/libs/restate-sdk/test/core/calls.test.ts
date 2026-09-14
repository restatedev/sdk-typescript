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

import { describe, expect, it } from "vitest";
import {
  CallCommand,
  CANCEL_SIGNAL_ID,
  MessageType,
  OneWayCallCommand,
  SendSignalCommand,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  codes,
  EMPTY_LIMIT_KEY,
  EMPTY_SCOPE,
  outOfBoundsDuration,
} from "../../src/endpoint/handlers/vm/ts/errors.js";
import type { Target } from "../../src/endpoint/handlers/vm/ts/types.js";
import {
  EndMessageDef,
  ErrorMessageDef,
  expectErrorMessageAsError,
  expectVMError,
  inputEntryMessage,
  mockInit,
  notification,
  startMessage,
  Version,
  VMTestCase,
} from "./testutils.js";

const target = (extra: Partial<Target> = {}): Target => ({
  service: "MySvc",
  handler: "MyHandler",
  headers: [],
  ...extra,
});

describe("calls", () => {
  it("call then get invocation id then cancel invocation", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "my-id",
        })
      )
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        expect(
          vm.doAwait({ Single: callHandle.invocationIdNotificationHandle })
        ).toEqual({ type: "anyCompleted" });
        const value = vm.takeNotification(
          callHandle.invocationIdNotificationHandle
        );
        expect(value).toEqual({ InvocationId: "my-id" });

        vm.sysCancelInvocation("my-id");

        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      create(SendSignalCommand.desc, {
        target_invocation_id: "my-id",
        idx: CANCEL_SIGNAL_ID,
        void: VOID,
      })
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("send then get invocation id then cancel invocation", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "my-id",
        })
      )
      .run((vm) => {
        vm.sysInput();

        const sendHandle = vm.sysSend(
          target(),
          new Uint8Array(0),
          undefined,
          undefined
        );

        expect(
          vm.doAwait({ Single: sendHandle.invocationIdNotificationHandle })
        ).toEqual({ type: "anyCompleted" });
        const value = vm.takeNotification(
          sendHandle.invocationIdNotificationHandle
        );
        expect(value).toEqual({ InvocationId: "my-id" });

        vm.sysCancelInvocation("my-id");

        vm.sysEnd();
      });

    expect(output.nextDecoded(OneWayCallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      create(SendSignalCommand.desc, {
        target_invocation_id: "my-id",
        idx: CANCEL_SIGNAL_ID,
        void: VOID,
      })
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("call with scope and limit key propagates to message", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        vm.sysCall(
          target({ scope: "tenant-a", limitKey: "user-42" }),
          new Uint8Array(0),
          undefined
        );

        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      scope: "tenant-a",
      limit_key: "user-42",
    });
  });

  it("send with scope and limit key propagates to message", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        vm.sysSend(
          target({ scope: "tenant-a", limitKey: "user-42" }),
          new Uint8Array(0),
          undefined,
          undefined
        );

        vm.sysEnd();
      });

    expect(output.nextDecoded(OneWayCallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      scope: "tenant-a",
      limit_key: "user-42",
    });
  });

  it("send with out of bounds delay fails", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();
        expect(() =>
          vm.sysSend(target(), new Uint8Array(0), 1n << 70n, undefined)
        ).toThrow();
      });

    expectErrorMessageAsError(
      output.nextDecoded(ErrorMessageDef),
      outOfBoundsDuration("send delay", "TryFromIntError(())")
    );
    output.expectEnd();
  });

  it("call with empty scope errors", () => {
    const vm = mockInit();
    vm.notifyInput(startMessage(1).bytes);
    vm.notifyInput(inputEntryMessage("my-data").bytes);
    vm.notifyInputClosed();
    vm.sysInput();

    const err = expectVMError(() =>
      vm.sysCall(target({ scope: "" }), new Uint8Array(0), undefined)
    );
    expect(err.code).toBe(EMPTY_SCOPE.code);
    expect(err.message).toBe(EMPTY_SCOPE.message);
  });

  it("call with empty limit key errors", () => {
    const vm = mockInit();
    vm.notifyInput(startMessage(1).bytes);
    vm.notifyInput(inputEntryMessage("my-data").bytes);
    vm.notifyInputClosed();
    vm.sysInput();

    const err = expectVMError(() =>
      vm.sysCall(
        target({ scope: "tenant-a", limitKey: "" }),
        new Uint8Array(0),
        undefined
      )
    );
    expect(err.code).toBe(EMPTY_LIMIT_KEY.code);
    expect(err.message).toBe(EMPTY_LIMIT_KEY.message);
  });

  it("call with scope on v6 returns unsupported feature", () => {
    const vm = mockInit(Version.V6);
    vm.notifyInput(startMessage(1).bytes);
    vm.notifyInput(inputEntryMessage("my-data").bytes);
    vm.notifyInputClosed();
    vm.sysInput();

    const err = expectVMError(() =>
      vm.sysCall(target({ scope: "tenant-a" }), new Uint8Array(0), undefined)
    );
    expect(err.code).toBe(codes.UNSUPPORTED_FEATURE);
  });

  it("call with limit key on v6 returns unsupported feature", () => {
    const vm = mockInit(Version.V6);
    vm.notifyInput(startMessage(1).bytes);
    vm.notifyInput(inputEntryMessage("my-data").bytes);
    vm.notifyInputClosed();
    vm.sysInput();

    const err = expectVMError(() =>
      vm.sysCall(target({ limitKey: "user-42" }), new Uint8Array(0), undefined)
    );
    expect(err.code).toBe(codes.UNSUPPORTED_FEATURE);
  });
});
