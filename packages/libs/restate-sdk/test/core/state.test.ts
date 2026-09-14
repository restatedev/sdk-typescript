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
  ClearAllStateCommand,
  ClearStateCommand,
  GetEagerStateCommand,
  GetEagerStateKeysCommand,
  GetLazyStateCommand,
  GetLazyStateKeysCommand,
  InputCommandMessageDesc,
  MessageType,
  SetStateCommand,
  StartMessageDesc,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import type { AsyncResultValue } from "../../src/endpoint/handlers/vm/ts/types.js";
import {
  b,
  EndMessageDef,
  expectClosed,
  expectEmpty,
  expectOutputWithSuccess,
  expectSuspended,
  expectSuspendedWaitingCompletion,
  inputEntryMessage,
  isSuspendedWhen,
  msg,
  notification,
  OutputCommandMessageDef,
  str,
  SuspensionMessageDef,
  VMTestCase,
} from "./testutils.js";

const start = (knownEntries: number, extra: object = {}) =>
  msg(MessageType.Start, StartMessageDesc, {
    id: b("abc"),
    debug_id: "abc",
    known_entries: knownEntries,
    partial_state: true,
    ...extra,
  });

/// Normal state
function getStateHandler(vm: CoreVM) {
  vm.sysInput();

  const h1 = vm.sysStateGet("STATE");

  if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
    expectClosed(() => vm.takeNotification(h1));
    return;
  }

  const value = vm.takeNotification(h1)!;
  let strResult: string;
  if (value === "Empty") {
    strResult = "Unknown";
  } else if ("Success" in value) {
    strResult = str(value.Success);
  } else {
    throw new Error("Unexpected variants");
  }

  vm.sysWriteOutput({ type: "success", value: b(strResult) });
  vm.sysEnd();
}

describe("state", () => {
  describe("only lazy state", () => {
    it("entry already completed", () => {
      const output = VMTestCase.new()
        .input(start(3))
        .input(inputEntryMessage("Till"))
        .input(
          msg(MessageType.GetLazyStateCommand, GetLazyStateCommand.desc, {
            key: b("STATE"),
            result_completion_id: 1,
          })
        )
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(getStateHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("entry already completed empty", () => {
      const output = VMTestCase.new()
        .input(start(3))
        .input(inputEntryMessage("Till"))
        .input(
          msg(MessageType.GetLazyStateCommand, GetLazyStateCommand.desc, {
            key: b("STATE"),
            result_completion_id: 1,
          })
        )
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            void: VOID,
          })
        )
        .run(getStateHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Unknown"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("new entry", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .run(getStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        1
      );
      output.expectEnd();
    });

    it("entry not completed on replay", () => {
      const output = VMTestCase.new()
        .input(start(2))
        .input(inputEntryMessage("Till"))
        .input(
          msg(MessageType.GetLazyStateCommand, GetLazyStateCommand.desc, {
            key: b("STATE"),
            result_completion_id: 1,
          })
        )
        .run(getStateHandler);

      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        1
      );
      output.expectEnd();
    });

    it("entry on replay completed later", () => {
      const output = VMTestCase.new()
        .input(start(2))
        .input(inputEntryMessage("Till"))
        .input(
          msg(MessageType.GetLazyStateCommand, GetLazyStateCommand.desc, {
            key: b("STATE"),
            result_completion_id: 1,
          })
        )
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(getStateHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("new entry completed later", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(getStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });

  describe("eager", () => {
    function getEmptyStateHandler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectClosed(() => vm.takeNotification(h1));
        return;
      }

      const value = vm.takeNotification(h1)!;
      let strResult: string;
      if (value === "Empty") {
        strResult = "true";
      } else if ("Success" in value) {
        strResult = "false";
      } else {
        throw new Error("Unexpected variants");
      }

      vm.sysWriteOutput({ type: "success", value: b(strResult) });
      vm.sysEnd();
    }

    const emptyInput = () =>
      msg(MessageType.InputCommand, InputCommandMessageDesc, {});

    it("get empty with complete state", () => {
      const output = VMTestCase.new()
        .input(start(1, { partial_state: false }))
        .input(emptyInput())
        .run(getEmptyStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("STATE"), void: VOID })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "true"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get empty with partial state", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(emptyInput())
        .run(getEmptyStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        1
      );
      output.expectEnd();
    });

    it("get empty resume with partial state", () => {
      const output = VMTestCase.new()
        .input(start(2))
        .input(emptyInput())
        .input(
          msg(MessageType.GetEagerStateCommand, GetEagerStateCommand.desc, {
            key: b("STATE"),
            void: VOID,
          })
        )
        .run(getEmptyStateHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "true"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get with complete state", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            partial_state: false,
            state_map: [{ key: b("STATE"), value: b("Francesco") }],
            key: "my-greeter",
          })
        )
        .input(emptyInput())
        .run(getStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("Francesco") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get with partial state", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            state_map: [{ key: b("STATE"), value: b("Francesco") }],
            key: "my-greeter",
          })
        )
        .input(emptyInput())
        .run(getStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("Francesco") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get with partial state without the state entry", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(emptyInput())
        .run(getStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        1
      );
      output.expectEnd();
    });

    function unwrapGet(
      vm: CoreVM,
      value: AsyncResultValue | undefined
    ): Uint8Array | undefined {
      if (value === undefined || value === "Empty") {
        throw new Error("Unexpected empty get state");
      }
      if ("Success" in value) {
        return value.Success;
      }
      if ("Failure" in value) {
        vm.sysWriteOutput({ type: "failure", failure: value.Failure });
        vm.sysEnd();
        return undefined;
      }
      throw new Error("Unexpected variants");
    }

    function appendStateHandler(vm: CoreVM) {
      const input = vm.sysInput().input;

      const h1 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectSuspended(() => vm.takeNotification(h1));
        return;
      }

      const getResult = unwrapGet(vm, vm.takeNotification(h1));
      if (getResult === undefined) {
        return;
      }

      const concat = new Uint8Array(getResult.length + input.length);
      concat.set(getResult, 0);
      concat.set(input, getResult.length);
      vm.sysStateSet("STATE", concat);

      const h2 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h2 }))) {
        expectSuspended(() => vm.takeNotification(h2));
        return;
      }

      const secondGetResult = unwrapGet(vm, vm.takeNotification(h2));
      if (secondGetResult === undefined) {
        return;
      }

      vm.sysWriteOutput({ type: "success", value: secondGetResult });
      vm.sysEnd();
    }

    it("append with state in the state map", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            state_map: [{ key: b("STATE"), value: b("Francesco") }],
            key: "my-greeter",
          })
        )
        .input(inputEntryMessage("Till"))
        .run(appendStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("Francesco") },
        })
      );
      expect(output.nextDecoded(SetStateCommand)).toEqual(
        create(SetStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("FrancescoTill") },
        })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("FrancescoTill") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "FrancescoTill"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("append with partial state on the first get", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(appendStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expect(output.nextDecoded(SetStateCommand)).toEqual(
        create(SetStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("FrancescoTill") },
        })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("FrancescoTill") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "FrancescoTill"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    function getAndClearStateHandler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectSuspended(() => vm.takeNotification(h1));
        return;
      }
      const firstGetResult = unwrapGet(vm, vm.takeNotification(h1))!;

      vm.sysStateClear("STATE");

      const h2 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h2 }))) {
        expectSuspended(() => vm.takeNotification(h2));
        return;
      }
      expectEmpty(vm.takeNotification(h2));

      vm.sysWriteOutput({ type: "success", value: firstGetResult });
      vm.sysEnd();
    }

    it("get and clear state with state in the state map", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            state_map: [{ key: b("STATE"), value: b("Francesco") }],
            key: "my-greeter",
          })
        )
        .input(inputEntryMessage("Till"))
        .run(getAndClearStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("Francesco") },
        })
      );
      expect(output.nextDecoded(ClearStateCommand)).toEqual(
        create(ClearStateCommand.desc, { key: b("STATE") })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("STATE"), void: VOID })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get and clear state with partial state on the first get", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(getAndClearStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expect(output.nextDecoded(ClearStateCommand)).toEqual(
        create(ClearStateCommand.desc, { key: b("STATE") })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("STATE"), void: VOID })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    function getAndClearAllStateHandler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysStateGet("STATE");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectSuspended(() => vm.takeNotification(h1));
        return;
      }
      const firstGetResult = unwrapGet(vm, vm.takeNotification(h1))!;

      vm.sysStateClearAll();

      const h2 = vm.sysStateGet("STATE");
      vm.doAwait({ Single: h2 });
      expectEmpty(vm.takeNotification(h2));

      const h3 = vm.sysStateGet("ANOTHER_STATE");
      vm.doAwait({ Single: h3 });
      expectEmpty(vm.takeNotification(h3));

      vm.sysWriteOutput({ type: "success", value: firstGetResult });
      vm.sysEnd();
    }

    it("get clear all with state in the state map", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            state_map: [
              { key: b("STATE"), value: b("Francesco") },
              { key: b("ANOTHER_STATE"), value: b("Francesco") },
            ],
            key: "my-greeter",
          })
        )
        .input(inputEntryMessage("Till"))
        .run(getAndClearAllStateHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("STATE"),
          value: { content: b("Francesco") },
        })
      );
      expect(output.nextDecoded(ClearAllStateCommand)).toEqual(
        create(ClearAllStateCommand.desc)
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("STATE"), void: VOID })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("ANOTHER_STATE"),
          void: VOID,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("get clear all with partial state on the first get", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .input(
          notification(MessageType.GetLazyStateCompletionNotification, {
            completion_id: 1,
            value: { content: b("Francesco") },
          })
        )
        .run(getAndClearAllStateHandler);

      expect(output.nextDecoded(GetLazyStateCommand)).toEqual(
        create(GetLazyStateCommand.desc, {
          key: b("STATE"),
          result_completion_id: 1,
        })
      );
      expect(output.nextDecoded(ClearAllStateCommand)).toEqual(
        create(ClearAllStateCommand.desc)
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("STATE"), void: VOID })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, {
          key: b("ANOTHER_STATE"),
          void: VOID,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "Francesco"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    function consecutiveGetWithEmptyHandler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysStateGet("key-0");
      vm.doAwait({ Single: h1 });
      expectEmpty(vm.takeNotification(h1));

      const h2 = vm.sysStateGet("key-0");
      vm.doAwait({ Single: h2 });
      expectEmpty(vm.takeNotification(h2));

      vm.sysWriteOutput({ type: "success", value: new Uint8Array(0) });
      vm.sysEnd();
    }

    it("consecutive get with empty", () => {
      const output = VMTestCase.new()
        .input(start(1, { partial_state: false }))
        .input(emptyInput())
        .run(consecutiveGetWithEmptyHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("key-0"), void: VOID })
      );
      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("key-0"), void: VOID })
      );
      expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "");
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("consecutive get with empty run with replay of the first get", () => {
      const output = VMTestCase.new()
        .input(start(2, { partial_state: false }))
        .input(emptyInput())
        .input(
          msg(MessageType.GetEagerStateCommand, GetEagerStateCommand.desc, {
            key: b("key-0"),
            void: VOID,
          })
        )
        .run(consecutiveGetWithEmptyHandler);

      expect(output.nextDecoded(GetEagerStateCommand)).toEqual(
        create(GetEagerStateCommand.desc, { key: b("key-0"), void: VOID })
      );
      expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "");
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });

  describe("state keys", () => {
    function getStateKeysHandler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysStateGetKeys();

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectClosed(() => vm.takeNotification(h1));
        return;
      }
      const value = vm.takeNotification(h1)!;
      if (typeof value !== "object" || !("StateKeys" in value)) {
        throw new Error("Unexpected variants");
      }

      vm.sysWriteOutput({
        type: "success",
        value: b(value.StateKeys.join(",")),
      });
      vm.sysEnd();
    }

    it("entry already completed", () => {
      const output = VMTestCase.new()
        .input(start(2))
        .input(inputEntryMessage("Till"))
        .input(
          msg(
            MessageType.GetEagerStateKeysCommand,
            GetEagerStateKeysCommand.desc,
            {
              value: { keys: [b("ANOTHER-STATE"), b("MY-STATE")] },
            }
          )
        )
        .run(getStateKeysHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "ANOTHER-STATE,MY-STATE"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("new entry", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .run(getStateKeysHandler);

      expect(output.nextDecoded(GetLazyStateKeysCommand)).toEqual(
        create(GetLazyStateKeysCommand.desc, { result_completion_id: 1 })
      );
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        1
      );
      output.expectEnd();
    });

    it("new entry completed later", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("Till"))
        .input(
          notification(MessageType.GetLazyStateKeysCompletionNotification, {
            completion_id: 1,
            state_keys: { keys: [b("MY-STATE"), b("ANOTHER-STATE")] },
          })
        )
        .run(getStateKeysHandler);

      expect(output.nextDecoded(GetLazyStateKeysCommand)).toEqual(
        create(GetLazyStateKeysCommand.desc, { result_completion_id: 1 })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "MY-STATE,ANOTHER-STATE"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("entry on replay completed later", () => {
      const output = VMTestCase.new()
        .input(start(2))
        .input(inputEntryMessage("Till"))
        .input(
          msg(
            MessageType.GetLazyStateKeysCommand,
            GetLazyStateKeysCommand.desc,
            {
              result_completion_id: 1,
            }
          )
        )
        .input(
          notification(MessageType.GetLazyStateKeysCompletionNotification, {
            completion_id: 1,
            state_keys: { keys: [b("MY-STATE"), b("ANOTHER-STATE")] },
          })
        )
        .run(getStateKeysHandler);

      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "MY-STATE,ANOTHER-STATE"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("sorts eager state keys by UTF-8 bytes, not UTF-16 code units", () => {
      // Rust sorts Vec<String> by UTF-8 bytes. A plain JS sort orders by UTF-16
      // code unit, which puts astral characters before U+E000..U+FFFF. These
      // keys go into the journal, so the two must agree.
      const output = VMTestCase.new()
        .input(
          start(1, {
            partial_state: false,
            state_map: [
              { key: b("b"), value: b("1") },
              { key: b("\u{1F600}"), value: b("2") },
              { key: b("\u8C48"), value: b("3") },
              { key: b("\uFF21"), value: b("4") },
            ],
          })
        )
        .input(inputEntryMessage("Till"))
        .run(getStateKeysHandler);

      const cmd = output.nextDecoded(GetEagerStateKeysCommand)!;
      expect(cmd.value!.keys.map((k) => str(k))).toEqual([
        "b",
        "\u8C48",
        "\uFF21",
        "\u{1F600}",
      ]);
      output.nextDecoded(OutputCommandMessageDef);
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("new entry completed with eager state", () => {
      const output = VMTestCase.new()
        .input(
          start(1, {
            partial_state: false,
            state_map: [
              { key: b("MY-STATE"), value: b("Francesco") },
              { key: b("ANOTHER-STATE"), value: b("Till") },
            ],
          })
        )
        .input(inputEntryMessage("Till"))
        .run(getStateKeysHandler);

      expect(output.nextDecoded(GetEagerStateKeysCommand)).toEqual(
        create(GetEagerStateKeysCommand.desc, {
          value: { keys: [b("ANOTHER-STATE"), b("MY-STATE")] },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "ANOTHER-STATE,MY-STATE"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });
});
