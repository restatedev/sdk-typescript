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
  CombinatorType,
  MessageType,
  SendSignalCommand,
  SleepCommand,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  defaultVMOptions,
  type Target,
} from "../../src/endpoint/handlers/vm/ts/types.js";
import {
  AwaitingOnMessageDef,
  b,
  cancelSignalNotification,
  EndMessageDef,
  expectOutputWithSuccess,
  expectSuccess,
  expectSuspended,
  inputEntryMessage,
  msg,
  notification,
  OutputCommandMessageDef,
  startMessage,
  str,
  SuspensionMessageDef,
  VMTestCase,
} from "./testutils.js";

const target = (service = "MySvc", handler = "MyHandler"): Target => ({
  service,
  handler,
  headers: [],
});

const cancelSignalCommand = (targetInvocationId: string) =>
  create(SendSignalCommand.desc, {
    target_invocation_id: targetInvocationId,
    idx: CANCEL_SIGNAL_ID,
    void: VOID,
  });

describe("implicit cancellation", () => {
  it("call then get invocation id then cancel", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "my-id",
        })
      )
      .input(cancelSignalNotification())
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        // invocation id is here, let's take it and assert it
        expect(
          vm.doAwait({ Single: callHandle.invocationIdNotificationHandle })
        ).toEqual({ type: "anyCompleted" });
        expect(
          vm.takeNotification(callHandle.invocationIdNotificationHandle)
        ).toEqual({ InvocationId: "my-id" });

        expect(
          vm.doAwait({ Single: callHandle.callNotificationHandle })
        ).toEqual({
          type: "cancelSignalReceived",
        });

        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      cancelSignalCommand("my-id")
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("call then cancel", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "my-id",
        })
      )
      .input(cancelSignalNotification())
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        expect(
          vm.doAwait({ Single: callHandle.callNotificationHandle })
        ).toEqual({
          type: "cancelSignalReceived",
        });

        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      cancelSignalCommand("my-id")
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("call then cancel without invocation id", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(cancelSignalNotification())
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        // Suspends because it's missing the invocation id to complete the cancellation
        expectSuspended(() =>
          vm.doAwait({ Single: callHandle.callNotificationHandle })
        );
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(SuspensionMessageDef)!.awaiting_on).toMatchObject(
      {
        waiting_completions: [1],
        waiting_signals: [],
        nested_futures: [],
        waiting_named_signals: [],
      }
    );
    output.expectEnd();
  });

  it("call then then cancel disabling children cancellation", () => {
    const output = VMTestCase.withVmOptions({
      ...defaultVMOptions(),
      implicitCancellation: {
        type: "enabled",
        cancelChildrenCalls: false,
        cancelChildrenOneWayCalls: true,
      },
    })
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(cancelSignalNotification())
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        expect(
          vm.doAwait({ Single: callHandle.callNotificationHandle })
        ).toEqual({
          type: "cancelSignalReceived",
        });

        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
    });
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("disabled implicit cancellation", () => {
    const output = VMTestCase.withVmOptions({
      ...defaultVMOptions(),
      implicitCancellation: { type: "disabled" },
    })
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .input(cancelSignalNotification())
      .run((vm) => {
        vm.sysInput();

        const callHandle = vm.sysCall(target(), new Uint8Array(0), undefined);

        // Just suspended
        expectSuspended(() =>
          vm.doAwait({ Single: callHandle.callNotificationHandle })
        );
      });

    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "MySvc",
      handler_name: "MyHandler",
      invocation_id_notification_idx: 1,
      result_completion_id: 2,
    });
    expect(output.nextDecoded(SuspensionMessageDef)!.awaiting_on).toMatchObject(
      {
        waiting_completions: [2],
        waiting_signals: [],
        nested_futures: [],
        waiting_named_signals: [],
      }
    );
    output.expectEnd();
  });

  it("replay while cancelling", () => {
    const output = VMTestCase.new()
      .input(startMessage(7))
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.CallCommand, CallCommand.desc, {
          service_name: "MySvc",
          handler_name: "MyHandler",
          invocation_id_notification_idx: 1,
          result_completion_id: 2,
        })
      )
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "my-id-1",
        })
      )
      .input(
        msg(MessageType.CallCommand, CallCommand.desc, {
          service_name: "MySvc",
          handler_name: "MyHandler",
          invocation_id_notification_idx: 3,
          result_completion_id: 4,
        })
      )
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 3,
          invocation_id: "my-id-2",
        })
      )
      .input(cancelSignalNotification())
      .input(
        msg(MessageType.SendSignalCommand, SendSignalCommand.desc, {
          target_invocation_id: "my-id-1",
          idx: CANCEL_SIGNAL_ID,
          void: VOID,
        })
      )
      .run((vm) => {
        vm.sysInput();

        const callHandle1 = vm.sysCall(target(), new Uint8Array(0), undefined);
        const callHandle2 = vm.sysCall(target(), new Uint8Array(0), undefined);

        // First time, responds with any completed, then suspends because it's missing the invocation id to complete the cancellation
        expect(
          vm.doAwait({
            FirstCompleted: [
              { Single: callHandle1.callNotificationHandle },
              { Single: callHandle2.callNotificationHandle },
            ],
          })
        ).toEqual({ type: "cancelSignalReceived" });

        vm.sysEnd();
      });

    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      cancelSignalCommand("my-id-2")
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  // Reproduces the is_none_or in is_handle_completed bug:
  // a handler that calls a downstream service, awaits it, then sleeps.
  // While sleeping, the invocation is cancelled. The handler catches the cancellation and runs a *compensation*:
  // a NEW downstream call (the "revert"/undo). The compensation call must run to completion and should not be canceled again.
  it("saga compensation call is not cancelled", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      // Forward "reserve" call resolves normally, *before* the cancellation:
      //  - its invocation id (needed later to propagate the cancel to it)
      //  - its result
      .input(
        notification(MessageType.CallInvocationIdCompletionNotification, {
          completion_id: 1,
          invocation_id: "reserve-invocation-id",
        })
      )
      .input(
        notification(MessageType.CallCompletionNotification, {
          completion_id: 2,
          value: { content: b("reserved") },
        })
      )
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        // ── Forward step: reserve via a downstream service, and await it.
        const reserve = vm.sysCall(
          target("Inventory", "reserve"),
          b("flight"),
          undefined
        );
        expect(vm.doAwait({ Single: reserve.callNotificationHandle })).toEqual({
          type: "anyCompleted",
        });
        expect(
          str(
            expectSuccess(vm.takeNotification(reserve.callNotificationHandle))
          )
        ).toBe("reserved");

        // ── Long sleep — the window in which we get cancelled.
        const sleep = vm.sysSleep("", 60_000n);

        // The cancellation arrives now, while we're sleeping.
        vm.notifyInput(cancelSignalNotification().bytes);

        // Awaiting the sleep surfaces the cancellation — this is where the
        // saga would `catch` and start compensating.
        expect(vm.doAwait({ Single: sleep })).toEqual({
          type: "cancelSignalReceived",
        });

        // ── Compensation step: unreserve via the downstream service.
        // A NEW call, made AFTER the cancellation was caught. It must run to
        // completion and MUST NOT be cancelled by the runtime.
        const unreserve = vm.sysCall(
          target("Inventory", "unreserve"),
          b("flight"),
          undefined
        );

        // Before the fix, this returned CancelSignalReceived.
        // With the fix, it completes normally.
        expect(
          vm.doAwait({ Single: unreserve.callNotificationHandle })
        ).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        // Send notifications for unreserve
        vm.notifyInput(
          notification(MessageType.CallInvocationIdCompletionNotification, {
            completion_id: 4,
            invocation_id: "unreserve-invocation-id",
          }).bytes
        );
        vm.notifyInput(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 5,
            value: { content: b("unreserved") },
          }).bytes
        );
        vm.notifyInputClosed();

        // Before the fix, this returned CancelSignalReceived.
        // With the fix, it completes normally.
        expect(
          vm.doAwait({ Single: unreserve.callNotificationHandle })
        ).toEqual({
          type: "anyCompleted",
        });
        const unreserved = expectSuccess(
          vm.takeNotification(unreserve.callNotificationHandle)
        );
        expect(str(unreserved)).toBe("unreserved");

        vm.sysWriteOutput({ type: "success", value: unreserved });
        vm.sysEnd();
      });

    // Forward reserve call.
    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "Inventory",
      handler_name: "reserve",
      invocation_id_notification_idx: 1,
      result_completion_id: 2,
    });
    // The sleep.
    expect(output.nextDecoded(SleepCommand)).toMatchObject({
      result_completion_id: 3,
    });
    // Cancellation propagates to the in-flight forward call.
    expect(output.nextDecoded(SendSignalCommand)).toEqual(
      cancelSignalCommand("reserve-invocation-id")
    );
    // The compensation call is journaled...
    expect(output.nextDecoded(CallCommand)).toMatchObject({
      service_name: "Inventory",
      handler_name: "unreserve",
      invocation_id_notification_idx: 4,
      result_completion_id: 5,
    });
    // The awaiting on the new call
    expect(output.nextDecoded(AwaitingOnMessageDef)).toEqual({
      awaiting_on: {
        waiting_signals: [1],
        waiting_completions: [5],
        waiting_named_signals: [],
        nested_futures: [],
        combinator_type: CombinatorType.FirstCompleted,
      },
      executing_side_effects: false,
    });
    // Finally, the output. No SendSignalCommandMessage targeting "unreserve-invocation-id".
    expectOutputWithSuccess(
      output.nextDecoded(OutputCommandMessageDef),
      "unreserved"
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });
});
