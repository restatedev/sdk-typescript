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
  CombinatorType,
  GetLazyStateCommand,
  MessageType,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  AwaitingOnMessageDef,
  b,
  EndMessageDef,
  expectOutputWithSuccess,
  expectSuccess,
  expectSuspended,
  expectSuspendedWaitingCompletion,
  inputEntryMessage,
  notification,
  OutputCommandMessageDef,
  startMessage,
  str,
  SuspensionMessageDef,
  VMTestCase,
} from "./testutils.js";

describe("suspensions", () => {
  it("trigger suspension with get state", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const handle = vm.sysStateGet("Personaggio");

        // Also take_async_result returns Ok(None)
        expect(vm.takeNotification(handle)).toBeUndefined();

        // Let's notify_input_closed now
        vm.notifyInputClosed();
        expectSuspended(() => vm.doAwait({ Single: handle }));
      });

    // Assert output
    expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
      create(GetLazyStateCommand.desc, {
        key: b("Personaggio"),
        result_completion_id: 1,
      })
    );
    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("trigger suspension with correct awakeable", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        vm.sysAwakeable();
        const h2 = vm.sysAwakeable().handle;

        // Also take_async_result returns Ok(None)
        expect(vm.takeNotification(h2)).toBeUndefined();

        // Let's notify_input_closed now
        vm.notifyInputClosed();
        expectSuspended(() => vm.doAwait({ Single: h2 }));
      });

    const suspension = output.nextDecoded(SuspensionMessageDef)!;
    expect(suspension.awaiting_on!.waiting_completions).toEqual([]);
    expect([...suspension.awaiting_on!.waiting_signals].sort()).toEqual([
      1, 18,
    ]);
    expect(suspension.awaiting_on!.nested_futures).toEqual([]);
    expect(suspension.awaiting_on!.waiting_named_signals).toEqual([]);
    expect(suspension.awaiting_on!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    output.expectEnd();
  });

  it("await many notifications", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const h1 = vm.sysAwakeable().handle;
        const h2 = vm.createSignalHandle("abc");
        const h3 = vm.sysStateGet("Personaggio");

        // Let's notify_input_closed now
        vm.notifyInputClosed();
        expectSuspended(() =>
          vm.doAwait({
            FirstCompleted: [{ Single: h1 }, { Single: h2 }, { Single: h3 }],
          })
        );
      });

    expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
      create(GetLazyStateCommand.desc, {
        key: b("Personaggio"),
        result_completion_id: 1,
      })
    );
    // Cancel signal wraps the original future: FirstCompleted([original, cancel])
    expect(output.nextDecoded(SuspensionMessageDef)).toEqual({
      awaiting_on: {
        waiting_completions: [],
        waiting_signals: [1],
        waiting_named_signals: [],
        nested_futures: [
          {
            waiting_completions: [1],
            waiting_signals: [17],
            waiting_named_signals: ["abc"],
            nested_futures: [],
            combinator_type: CombinatorType.FirstCompleted,
          },
        ],
        combinator_type: CombinatorType.FirstCompleted,
      },
    });
    output.expectEnd();
  });

  it("when notify completion then notify await point then notify input closed then no suspension", () => {
    const completion = b("completion");

    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const h1 = vm.sysAwakeable().handle;
        const h2 = vm.sysAwakeable().handle;

        // Do progress will ask for more input
        expect(
          vm.doAwait({ FirstCompleted: [{ Single: h1 }, { Single: h2 }] })
        ).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        // Let's send Completion for h2
        vm.notifyInput(
          notification(MessageType.SignalNotification, {
            signal_id: 18,
            value: { content: completion },
          }).bytes
        );

        // This should not suspend
        vm.notifyInputClosed();
        expect(
          vm.doAwait({ FirstCompleted: [{ Single: h1 }, { Single: h2 }] })
        ).toEqual({ type: "anyCompleted" });

        // H2 should be completed and we can take it
        expect(vm.isCompleted(h2)).toBe(true);
        expect(str(expectSuccess(vm.takeNotification(h2)))).toBe("completion");

        vm.sysWriteOutput({ type: "success", value: completion });
        vm.sysEnd();
      });

    // First do_progress returned WaitingExternalProgress, emits AwaitingOnMessage
    // Future is FirstCompleted([FirstCompleted([Single(signal_17), Single(signal_18)]), Single(cancel)])
    const awaitingOn = output.nextDecoded(AwaitingOnMessageDef)!;
    expect(awaitingOn.executing_side_effects).toBe(false);
    expect(awaitingOn.awaiting_on!.waiting_signals).toEqual([1]);
    expect(awaitingOn.awaiting_on!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    expect(awaitingOn.awaiting_on!.nested_futures).toHaveLength(1);
    expect(
      [...awaitingOn.awaiting_on!.nested_futures[0]!.waiting_signals].sort()
    ).toEqual([17, 18]);
    expect(awaitingOn.awaiting_on!.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    expectOutputWithSuccess(
      output.nextDecoded(OutputCommandMessageDef),
      completion
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });
});
