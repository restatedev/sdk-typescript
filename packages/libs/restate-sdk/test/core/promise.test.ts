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
  CompletePromiseCommand,
  GetPromiseCommand,
  InputCommandMessageDesc,
  MessageType,
  PeekPromiseCommand,
  StartMessageDesc,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import type { NonEmptyValue } from "../../src/endpoint/handlers/vm/ts/types.js";
import {
  b,
  EndMessageDef,
  expectClosed,
  expectOutputWithFailure,
  expectOutputWithSuccess,
  isSuspendedWhen,
  msg,
  notification,
  OutputCommandMessageDef,
  VMTestCase,
} from "./testutils.js";

const start = () =>
  msg(MessageType.Start, StartMessageDesc, {
    id: b("abc"),
    debug_id: "abc",
    known_entries: 1,
    partial_state: true,
  });

const emptyInput = () => msg(MessageType.InputCommand, InputCommandMessageDesc);

describe("promise", () => {
  describe("get promise", () => {
    function handler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysGetPromise("my-prom");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectClosed(() => vm.takeNotification(h1));
        return;
      }
      const value = vm.takeNotification(h1);
      expect(value, "Should be ready").toBeDefined();
      let output: NonEmptyValue;
      if (value === "Empty") {
        throw new Error("Got void result, unexpected for get promise");
      } else if (typeof value === "object" && "Success" in value!) {
        output = { type: "success", value: value.Success };
      } else if (typeof value === "object" && "Failure" in value!) {
        output = { type: "failure", failure: value.Failure };
      } else {
        throw new Error(`Unexpected value ${JSON.stringify(value)}`);
      }

      vm.sysWriteOutput(output);
      vm.sysEnd();
    }

    it("completed with success", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.GetPromiseCompletionNotification, {
            completion_id: 1,
            value: { content: b('"my value"') },
          })
        )
        .run(handler);

      expect(output.nextDecoded(GetPromiseCommand)).toEqual(
        create(GetPromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        '"my value"'
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("completed with failure", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.GetPromiseCompletionNotification, {
            completion_id: 1,
            failure: { code: 500, message: "myerror", metadata: [] },
          })
        )
        .run(handler);

      expect(output.nextDecoded(GetPromiseCommand)).toEqual(
        create(GetPromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
        })
      );
      expectOutputWithFailure(
        output.nextDecoded(OutputCommandMessageDef),
        500,
        "myerror"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });

  describe("peek promise", () => {
    function handler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysPeekPromise("my-prom");

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectClosed(() => vm.takeNotification(h1));
        return;
      }
      const value = vm.takeNotification(h1);
      expect(value, "Should be ready").toBeDefined();
      let output: NonEmptyValue;
      if (value === "Empty") {
        output = { type: "success", value: b("null") };
      } else if (typeof value === "object" && "Success" in value!) {
        output = { type: "success", value: value.Success };
      } else if (typeof value === "object" && "Failure" in value!) {
        output = { type: "failure", failure: value.Failure };
      } else {
        throw new Error(`Unexpected value ${JSON.stringify(value)}`);
      }

      vm.sysWriteOutput(output);
      vm.sysEnd();
    }

    it("completed with success", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.PeekPromiseCompletionNotification, {
            completion_id: 1,
            value: { content: b('"my value"') },
          })
        )
        .run(handler);

      expect(output.nextDecoded(PeekPromiseCommand)).toEqual(
        create(PeekPromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        '"my value"'
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("completed with failure", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.PeekPromiseCompletionNotification, {
            completion_id: 1,
            failure: { code: 500, message: "myerror", metadata: [] },
          })
        )
        .run(handler);

      expect(output.nextDecoded(PeekPromiseCommand)).toEqual(
        create(PeekPromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
        })
      );
      expectOutputWithFailure(
        output.nextDecoded(OutputCommandMessageDef),
        500,
        "myerror"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("completed with null", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.PeekPromiseCompletionNotification, {
            completion_id: 1,
            void: VOID,
          })
        )
        .run(handler);

      expect(output.nextDecoded(PeekPromiseCommand)).toEqual(
        create(PeekPromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "null"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });

  describe("complete promise", () => {
    const RESOLVED = "true";
    const REJECTED = "false";

    const handler = (result: NonEmptyValue) => (vm: CoreVM) => {
      vm.sysInput();

      const h1 = vm.sysCompletePromise("my-prom", result);

      if (isSuspendedWhen(() => vm.doAwait({ Single: h1 }))) {
        expectClosed(() => vm.takeNotification(h1));
        return;
      }
      const value = vm.takeNotification(h1);
      expect(value, "Should be ready").toBeDefined();
      let output: string;
      if (value === "Empty") {
        output = RESOLVED;
      } else if (typeof value === "object" && "Success" in value!) {
        throw new Error("Unexpected success completion");
      } else if (typeof value === "object" && "Failure" in value!) {
        output = REJECTED;
      } else {
        throw new Error(`Unexpected value ${JSON.stringify(value)}`);
      }

      vm.sysWriteOutput({ type: "success", value: b(output) });
      vm.sysEnd();
    };

    it("resolve promise succeeds", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.CompletePromiseCompletionNotification, {
            completion_id: 1,
            void: VOID,
          })
        )
        .run(handler({ type: "success", value: b("my val") }));

      expect(output.nextDecoded(CompletePromiseCommand)).toEqual(
        create(CompletePromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
          completion_value: { content: b("my val") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        RESOLVED
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("resolve promise fails", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.CompletePromiseCompletionNotification, {
            completion_id: 1,
            failure: {
              code: 500,
              message: "cannot write promise",
              metadata: [],
            },
          })
        )
        .run(handler({ type: "success", value: b("my val") }));

      expect(output.nextDecoded(CompletePromiseCommand)).toEqual(
        create(CompletePromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
          completion_value: { content: b("my val") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        REJECTED
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("reject promise succeeds", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.CompletePromiseCompletionNotification, {
            completion_id: 1,
            void: VOID,
          })
        )
        .run(
          handler({
            type: "failure",
            failure: { code: 500, message: "my failure", metadata: [] },
          })
        );

      expect(output.nextDecoded(CompletePromiseCommand)).toEqual(
        create(CompletePromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
          completion_failure: {
            code: 500,
            message: "my failure",
            metadata: [],
          },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        RESOLVED
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("reject promise fails", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(emptyInput())
        .input(
          notification(MessageType.CompletePromiseCompletionNotification, {
            completion_id: 1,
            failure: {
              code: 500,
              message: "cannot write promise",
              metadata: [],
            },
          })
        )
        .run(
          handler({
            type: "failure",
            failure: { code: 500, message: "my failure", metadata: [] },
          })
        );

      expect(output.nextDecoded(CompletePromiseCommand)).toEqual(
        create(CompletePromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
          completion_failure: {
            code: 500,
            message: "my failure",
            metadata: [],
          },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        REJECTED
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });
  });
});
