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
import type { CoreVM } from "../../src/endpoint/handlers/vm/ts/vm.js";
import {
  MessageType,
  SleepCommand,
  StartMessageDesc,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { outOfBoundsDuration } from "../../src/endpoint/handlers/vm/ts/errors.js";
import {
  b,
  EndMessageDef,
  ErrorMessageDef,
  expectClosed,
  expectEmpty,
  expectErrorMessageAsError,
  expectOutputWithSuccess,
  expectSuspendedWaitingCompletion,
  inputEntryMessage,
  isSuspendedWhen,
  msg,
  notification,
  OutputCommandMessageDef,
  SuspensionMessageDef,
  VMTestCase,
} from "./testutils.js";

function sleepHandler(vm: CoreVM) {
  vm.sysInput();

  const h1 = vm.sysSleep("", 1000n);

  if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
    expectClosed(() => vm.takeNotification(h1));
    return;
  }
  expectEmpty(vm.takeNotification(h1));

  vm.sysWriteOutput({ type: "success", value: new Uint8Array(0) });
  vm.sysEnd();
}

describe("sleep", () => {
  it("sleep suspends", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("abc"),
          debug_id: "abc",
          known_entries: 1,
          partial_state: true,
        })
      )
      .input(inputEntryMessage("Till"))
      .run(sleepHandler);

    expect(output.nextDecoded(SleepCommand)).toMatchObject({
      result_completion_id: 1,
    });
    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("sleep completed", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("abc"),
          debug_id: "abc",
          known_entries: 3,
          partial_state: true,
        })
      )
      .input(inputEntryMessage("Till"))
      .input(
        msg(MessageType.SleepCommand, SleepCommand.desc, {
          wake_up_time: 1721123699086n,
          result_completion_id: 1,
        })
      )
      .input(
        notification(MessageType.SleepCompletionNotification, {
          completion_id: 1,
          void: VOID,
        })
      )
      .run(sleepHandler);

    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "");
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("sleep still sleeping", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("abc"),
          debug_id: "abc",
          known_entries: 2,
          partial_state: true,
        })
      )
      .input(inputEntryMessage("Till"))
      .input(
        msg(MessageType.SleepCommand, SleepCommand.desc, {
          wake_up_time: 1721123699086n,
          result_completion_id: 1,
        })
      )
      .run(sleepHandler);

    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("sleep with out of bounds duration fails", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("abc"),
          debug_id: "abc",
          known_entries: 1,
          partial_state: true,
        })
      )
      .input(inputEntryMessage("Till"))
      .run((vm) => {
        vm.sysInput();
        // A wake-up instant whose milliseconds overflow u64 must surface as a
        // clean error rather than panicking on the checked conversion.
        expect(() => vm.sysSleep("", 1n << 70n)).toThrow();
      });

    expectErrorMessageAsError(
      output.nextDecoded(ErrorMessageDef),
      outOfBoundsDuration("sleep duration", "TryFromIntError(())")
    );
    output.expectEnd();
  });
});
