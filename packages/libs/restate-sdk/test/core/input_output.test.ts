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
  InputCommandMessageDesc,
  MessageType,
  OutputCommandMessageDesc,
  StartMessageDesc,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import {
  b,
  EndMessageDef,
  expectOutputWithSuccess,
  inputEntryMessage,
  mockInit,
  msg,
  OutputCommandMessageDef,
  str,
  Version,
  VMTestCase,
} from "./testutils.js";

function echoHandler(vm: CoreVM) {
  const { input } = vm.sysInput();
  expect(str(input)).toBe("my-data");

  vm.sysWriteOutput({ type: "success", value: input });
  vm.sysEnd();
}

describe("input/output", () => {
  it("echo", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(inputEntryMessage("my-data"))
      .run(echoHandler);

    expectOutputWithSuccess(
      output.nextDecoded(OutputCommandMessageDef),
      "my-data"
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("headers", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(
        msg(MessageType.InputCommand, InputCommandMessageDesc, {
          headers: [{ key: "x-my-header", value: "my-value" }],
          value: { content: b("other-value") },
        })
      )
      .run((vm) => {
        const { headers } = vm.sysInput();
        expect(headers).toEqual([{ key: "x-my-header", value: "my-value" }]);

        vm.sysWriteOutput({ type: "success", value: new Uint8Array(0) });
        vm.sysEnd();
      });

    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "");
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("start message v7 fields surface on input", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
          scope: "tenant-a",
          limit_key: "user-42",
          idempotency_key: "idem-7",
        })
      )
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        const input = vm.sysInput();
        expect(input.scope).toBe("tenant-a");
        expect(input.limitKey).toBe("user-42");
        expect(input.idempotencyKey).toBe("idem-7");

        vm.sysWriteOutput({ type: "success", value: new Uint8Array(0) });
        vm.sysEnd();
      });

    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "");
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("start message v7 fields dropped on v6", () => {
    const vm = mockInit(Version.V6);

    vm.notifyInput(
      msg(MessageType.Start, StartMessageDesc, {
        id: b("123"),
        debug_id: "123",
        known_entries: 1,
        scope: "tenant-a",
        limit_key: "user-42",
        idempotency_key: "idem-7",
      }).bytes
    );
    vm.notifyInput(inputEntryMessage("my-data").bytes);
    vm.notifyInputClosed();

    const input = vm.sysInput();
    expect(input.scope).toBeUndefined();
    expect(input.limitKey).toBeUndefined();
    expect(input.idempotencyKey).toBeUndefined();
  });

  it("replay output too", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 2,
        })
      )
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.OutputCommand, OutputCommandMessageDesc, {
          value: { content: b("my-data") },
        })
      )
      .run(echoHandler);

    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("take output on newly initialized vm", () => {
    const vm = mockInit();
    expect(vm.takeOutput()).toEqual(new Uint8Array(0));
  });

  it("instantiate core vm minimum supported version", () => {
    mockInit(Version.V5);
  });
});
