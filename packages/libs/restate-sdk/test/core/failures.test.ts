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
import { awakeableIdStr } from "../../src/endpoint/handlers/vm/ts/vm.js";
import {
  CallCommand,
  CompleteAwakeableCommand,
  CompletePromiseCommand,
  ErrorBehavior,
  GetEagerStateCommand,
  GetLazyStateCommand,
  InputCommandMessageDesc,
  MessageType,
  OneWayCallCommand,
  OutputCommandMessageDesc,
  RunCommand,
  SetStateCommand,
  SleepCommand,
  StartMessageDesc,
  VOID,
  type CommandMessageDef,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  codes,
  commandMismatchError,
  INPUT_CLOSED_WHILE_WAITING_ENTRIES,
  uncompletedDoProgressDuringReplay,
  VMError,
  type NotificationMetadata,
} from "../../src/endpoint/handlers/vm/ts/errors.js";
import {
  completionId,
  defaultVMOptions,
  JournalMismatchRetryBehavior,
  NonDeterministicChecksOption,
  notificationIdKey,
  signalId,
  WasmCommandType,
  type NotificationId,
  type Target,
  type VMOptions,
} from "../../src/endpoint/handlers/vm/ts/types.js";
import {
  b,
  EndMessageDef,
  ErrorMessageDef,
  expectErrorMessageAsError,
  expectVMError,
  inputEntryMessage,
  mockInit,
  msg,
  notification,
  OutputIterator,
  startMessage,
  Version,
  VMTestCase,
  type InputMessage,
} from "./testutils.js";

function expectErrorEquals(actual: VMError, expected: VMError) {
  expect(actual.code).toBe(expected.code);
  expect(actual.message).toBe(expected.message);
  expect(actual.stacktrace).toBe(expected.stacktrace);
  expect(actual.relatedCommand).toEqual(expected.relatedCommand);
}

describe("failures", () => {
  it("got closed stream before end of replay", () => {
    const vm = mockInit();

    vm.notifyInput(
      msg(MessageType.Start, StartMessageDesc, {
        id: b("123"),
        debug_id: "123",
        // 2 expected entries!
        known_entries: 2,
      }).bytes
    );
    vm.notifyInput(
      msg(MessageType.InputCommand, InputCommandMessageDesc).bytes
    );

    // Now notify input closed
    vm.notifyInputClosed();

    // Try to check if input is ready, this should fail
    const err = expectVMError(() => vm.isReadyToExecute());
    expect(err.code).toBe(INPUT_CLOSED_WHILE_WAITING_ENTRIES.code);
    expect(err.message).toBe(INPUT_CLOSED_WHILE_WAITING_ENTRIES.message);

    const output = new OutputIterator(vm);
    expectErrorMessageAsError(
      output.nextDecoded(ErrorMessageDef),
      INPUT_CLOSED_WHILE_WAITING_ENTRIES
    );
    output.expectEnd();
  });

  it("explicit error notification", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        vm.notifyError(
          VMError.internal("my-error").withNextRetryDelayOverride(10_000),
          { type: "next", ty: WasmCommandType.Call }
        );
      });
    expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
      code: 500,
      message: "my-error",
      related_command_type: MessageType.CallCommand,
      related_command_index: 1,
      next_retry_delay: 10_000n,
    });
    output.expectEnd();
  });

  it("notify error with should pause", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        vm.notifyError(VMError.internal("please pause").withShouldPause(true));
      });
    expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
      code: 500,
      message: "please pause",
      behavior: ErrorBehavior.Pause,
      next_retry_delay: undefined,
    });
    output.expectEnd();
  });

  it("notify error with should pause on v6 emits unsupported feature", () => {
    const output = VMTestCase.withVersion(Version.V6)
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        vm.notifyError(VMError.internal("please pause").withShouldPause(true));
      });
    expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
      code: codes.UNSUPPORTED_FEATURE,
      behavior: ErrorBehavior.Retry,
    });
    output.expectEnd();
  });

  describe("journal mismatch", () => {
    const target = (extra: Partial<Target> = {}): Target => ({
      service: "greeter",
      handler: "greet",
      key: "my-key",
      headers: [],
      ...extra,
    });

    function expectMismatchOnReplay<M extends object>(
      def: CommandMessageDef<M>,
      journalEntry: M,
      userEntry: M,
      userCode: (vm: CoreVM) => unknown
    ) {
      const output = VMTestCase.new()
        .input(
          msg(MessageType.Start, StartMessageDesc, {
            id: b("123"),
            debug_id: "123",
            known_entries: 2,
            partial_state: true,
          })
        )
        .input(inputEntryMessage("my-data"))
        .input(msg(def.ty, def.desc, journalEntry))
        .run((vm) => {
          vm.sysInput();

          const expectedError = commandMismatchError(
            1,
            def,
            journalEntry,
            userEntry
          ).withRelatedCommandMetadata({
            index: 1,
            ty: def.ty,
            name: undefined,
          });
          expectErrorEquals(
            expectVMError(() => userCode(vm)),
            expectedError
          );
        });

      expectErrorMessageAsError(
        output.nextDecoded(ErrorMessageDef),
        commandMismatchError(1, def, journalEntry, userEntry)
      );
      output.expectEnd();
    }

    it("get lazy state mismatch", () => {
      expectMismatchOnReplay(
        GetLazyStateCommand,
        create(GetLazyStateCommand.desc, {
          key: b("my-key"),
          result_completion_id: 1,
        }),
        create(GetLazyStateCommand.desc, {
          key: b("another-key"),
          result_completion_id: 1,
        }),
        (vm) => vm.sysStateGet("another-key")
      );
    });

    it("set state mismatch", () => {
      expectMismatchOnReplay(
        SetStateCommand,
        create(SetStateCommand.desc, {
          key: b("my-key"),
          value: { content: b("my-value") },
        }),
        create(SetStateCommand.desc, {
          key: b("my-key"),
          value: { content: b("another-value") },
        }),
        (vm) => vm.sysStateSet("my-key", b("another-value"))
      );
    });

    it("one way call mismatch", () => {
      expectMismatchOnReplay(
        OneWayCallCommand,
        create(OneWayCallCommand.desc, {
          service_name: "greeter",
          handler_name: "greet",
          key: "my-key",
          parameter: b("123"),
          invocation_id_notification_idx: 1,
        }),
        create(OneWayCallCommand.desc, {
          service_name: "greeter",
          handler_name: "greet",
          key: "my-key",
          parameter: b("456"),
          invocation_id_notification_idx: 1,
        }),
        (vm) => vm.sysSend(target(), b("456"), undefined, undefined)
      );
    });

    /**
     * Replays a one way call triggering a JOURNAL_MISMATCH error, then asserts the resulting
     * ErrorMessage carries the expected ErrorBehavior.
     */
    function expectErrorBehavior(
      testCase: VMTestCase,
      expectedBehavior: ErrorBehavior
    ) {
      const output = testCase
        .input(startMessage(2))
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.OneWayCallCommand, OneWayCallCommand.desc, {
            service_name: "greeter",
            handler_name: "greet",
            key: "my-key",
            parameter: b("123"),
            invocation_id_notification_idx: 1,
          })
        )
        .run((vm) => {
          vm.sysInput();

          // Different parameter than recorded -> journal mismatch
          expectVMError(() =>
            vm.sysSend(target(), b("456"), undefined, undefined)
          );
        });

      expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
        code: codes.JOURNAL_MISMATCH,
        behavior: expectedBehavior,
        next_retry_delay: undefined,
      });
      output.expectEnd();
    }

    const withBehavior = (
      version: Version,
      behavior: JournalMismatchRetryBehavior
    ) =>
      VMTestCase.withVersionAndVmOptions(version, {
        ...defaultVMOptions(),
        journalMismatchRetryBehavior: behavior,
      });

    it("pause retry policy sets pause behavior on mismatch", () => {
      expectErrorBehavior(
        withBehavior(Version.V7, JournalMismatchRetryBehavior.Pause),
        ErrorBehavior.Pause
      );
    });

    it("fail retry policy sets fail behavior on mismatch", () => {
      expectErrorBehavior(
        withBehavior(Version.V7, JournalMismatchRetryBehavior.FailTerminally),
        ErrorBehavior.Fail
      );
    });

    it("follow retry policy keeps retry behavior on mismatch", () => {
      expectErrorBehavior(
        withBehavior(
          Version.V7,
          JournalMismatchRetryBehavior.FollowRetryPolicy
        ),
        ErrorBehavior.Retry
      );
    });

    it("pause retry policy on v6 keeps retry behavior", () => {
      expectErrorBehavior(
        withBehavior(Version.V6, JournalMismatchRetryBehavior.Pause),
        ErrorBehavior.Retry
      );
    });

    it("fail retry policy on v6 keeps retry behavior", () => {
      expectErrorBehavior(
        withBehavior(Version.V6, JournalMismatchRetryBehavior.FailTerminally),
        ErrorBehavior.Retry
      );
    });

    it("disable non deterministic payload checks on vm", () => {
      const options: VMOptions = {
        ...defaultVMOptions(),
        nonDeterminismChecks:
          NonDeterministicChecksOption.PayloadChecksDisabled,
      };
      const output = VMTestCase.withVmOptions(options)
        .input(
          msg(MessageType.Start, StartMessageDesc, {
            id: b("123"),
            debug_id: "123",
            known_entries: 5,
            partial_state: true,
            // NOTE: this is different payload than the one recorded in the entry!
            state_map: [{ key: b("STATE"), value: b("456") }],
          })
        )
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.OneWayCallCommand, OneWayCallCommand.desc, {
            service_name: "greeter",
            handler_name: "greet",
            key: "my-key",
            parameter: b("123"),
            invocation_id_notification_idx: 1,
          })
        )
        .input(
          msg(MessageType.CallCommand, CallCommand.desc, {
            service_name: "greeter",
            handler_name: "greet",
            key: "my-key",
            parameter: b("123"),
            invocation_id_notification_idx: 2,
            result_completion_id: 3,
          })
        )
        .input(
          msg(MessageType.SetStateCommand, SetStateCommand.desc, {
            key: b("my-key"),
            value: { content: b("123") },
          })
        )
        .input(
          msg(MessageType.GetEagerStateCommand, GetEagerStateCommand.desc, {
            key: b("STATE"),
            value: { content: b("123") },
          })
        )
        .run((vm) => {
          vm.sysInput();

          // NOTE: this is different payload!
          vm.sysSend(target(), b("456"), undefined, undefined);

          // NOTE: this is different payload!
          vm.sysCall(target(), b("456"), undefined);

          // NOTE: this is different payload!
          vm.sysStateSet("my-key", b("456"));

          vm.sysStateGet("STATE");

          vm.sysEnd();
        });

      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    // Tests for PayloadOptions unstable serialization on different operations

    const unstable = { unstableSerialization: true };

    function expectOnlyEnd(
      replayed: InputMessage,
      userCode: (vm: CoreVM) => void
    ) {
      const output = VMTestCase.new()
        .input(startMessage(2))
        .input(inputEntryMessage("my-data"))
        .input(replayed)
        .run((vm) => {
          vm.sysInput();
          userCode(vm);
          vm.sysEnd();
        });

      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    }

    it("one way call with unstable payload", () => {
      expectOnlyEnd(
        msg(MessageType.OneWayCallCommand, OneWayCallCommand.desc, {
          service_name: "greeter",
          handler_name: "greet",
          key: "my-key",
          parameter: b("123"),
          invocation_id_notification_idx: 1,
        }),
        // Different bytes than recorded, but current side is flagged.
        (vm) => vm.sysSend(target(), b("456"), undefined, undefined, unstable)
      );
    });

    it("call with unstable payload", () => {
      expectOnlyEnd(
        msg(MessageType.CallCommand, CallCommand.desc, {
          service_name: "greeter",
          handler_name: "greet",
          key: "my-key",
          parameter: b("123"),
          invocation_id_notification_idx: 1,
          result_completion_id: 2,
        }),
        (vm) => vm.sysCall(target(), b("456"), undefined, unstable)
      );
    });

    it("set state with unstable payload", () => {
      expectOnlyEnd(
        msg(MessageType.SetStateCommand, SetStateCommand.desc, {
          key: b("my-key"),
          value: { content: b("123") },
        }),
        (vm) => vm.sysStateSet("my-key", b("456"), unstable)
      );
    });

    it("get eager state with unstable payload", () => {
      const output = VMTestCase.new()
        .input(
          msg(MessageType.Start, StartMessageDesc, {
            id: b("123"),
            debug_id: "123",
            known_entries: 2,
            partial_state: false,
            // This is the "current" value, different from recorded
            state_map: [{ key: b("my-key"), value: b("456") }],
          })
        )
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.GetEagerStateCommand, GetEagerStateCommand.desc, {
            key: b("my-key"),
            value: { content: b("123") },
          })
        )
        .run((vm) => {
          vm.sysInput();

          // With unstable serialization, different payload should be accepted
          vm.sysStateGet("my-key", unstable);

          vm.sysEnd();
        });

      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("complete promise with unstable payload", () => {
      expectOnlyEnd(
        msg(MessageType.CompletePromiseCommand, CompletePromiseCommand.desc, {
          key: "my-prom",
          result_completion_id: 1,
          completion_value: { content: b("123") },
        }),
        (vm) =>
          vm.sysCompletePromise(
            "my-prom",
            { type: "success", value: b("456") },
            unstable
          )
      );
    });

    it("complete awakeable with unstable payload", () => {
      expectOnlyEnd(
        msg(
          MessageType.CompleteAwakeableCommand,
          CompleteAwakeableCommand.desc,
          {
            awakeable_id: "awk-123",
            value: { content: b("123") },
          }
        ),
        (vm) =>
          vm.sysCompleteAwakeable(
            "awk-123",
            { type: "success", value: b("456") },
            unstable
          )
      );
    });

    it("write output with unstable payload", () => {
      expectOnlyEnd(
        msg(MessageType.OutputCommand, OutputCommandMessageDesc, {
          value: { content: b("123") },
        }),
        (vm) =>
          vm.sysWriteOutput({ type: "success", value: b("456") }, unstable)
      );
    });

    function metadataMap(
      entries: [NotificationId, NotificationMetadata][]
    ): Map<string, NotificationMetadata> {
      return new Map(entries.map(([id, m]) => [notificationIdKey(id), m]));
    }

    it("add await run after progress was made", () => {
      const runMetadata = {
        name: "my-side-effect",
        index: 1,
        ty: MessageType.RunCommand,
      };
      const expectedError = uncompletedDoProgressDuringReplay(
        [completionId(1), signalId(1)],
        metadataMap([
          [completionId(1), { type: "relatedToCommand", command: runMetadata }],
          [signalId(1), { type: "cancellation" }],
        ])
      ).withRelatedCommandMetadata(runMetadata);

      const output = VMTestCase.new()
        .input(startMessage(4))
        .input(inputEntryMessage("my-data"))
        // We have a run
        .input(
          msg(MessageType.RunCommand, RunCommand.desc, {
            result_completion_id: 1,
            name: "my-side-effect",
          })
        )
        // Then we have a sleep that is already completed
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 2,
          })
        )
        .input(
          notification(MessageType.SleepCompletionNotification, {
            completion_id: 2,
            void: VOID,
          })
        )
        .run((vm) => {
          vm.sysInput();

          const runHandle = vm.sysRun("my-side-effect").handle;

          // On await, this is the expected error
          expectErrorEquals(
            expectVMError(() => vm.doAwait({ Single: runHandle })),
            expectedError
          );
        });

      expectErrorMessageAsError(
        output.nextDecoded(ErrorMessageDef),
        expectedError
      );
      output.expectEnd();
    });

    it("add await sleep after progress was made", () => {
      const expectedError = uncompletedDoProgressDuringReplay(
        [completionId(1), signalId(1)],
        metadataMap([[signalId(1), { type: "cancellation" }]])
      );

      const output = VMTestCase.new()
        .input(startMessage(4))
        .input(inputEntryMessage("my-data"))
        // We have the first sleep
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 1,
          })
        )
        // Then we have a sleep that is already completed
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 2,
          })
        )
        .input(
          notification(MessageType.SleepCompletionNotification, {
            completion_id: 2,
            void: VOID,
          })
        )
        .run((vm) => {
          vm.sysInput();

          // Simulating the user code to be:
          //
          // await sleep()
          // await sleep()
          //
          // But this journal could have been created only with the following code:
          // sleep()
          // await sleep()
          //
          // Otherwise the notification for the first sleep should be in the journal before the second sleep!

          const sleepHandle = vm.sysSleep("", 0n);

          // On await, this is the expected error
          expectErrorEquals(
            expectVMError(() => vm.doAwait({ Single: sleepHandle })),
            expectedError
          );
        });

      expectErrorMessageAsError(
        output.nextDecoded(ErrorMessageDef),
        expectedError
      );
      output.expectEnd();
    });

    it("add await awakeable after progress was made", () => {
      const invocationId = b("123");

      const expectedError = uncompletedDoProgressDuringReplay(
        [signalId(17), signalId(1)],
        metadataMap([
          [
            signalId(17),
            { type: "awakeable", id: awakeableIdStr(invocationId, 17) },
          ],
          [signalId(1), { type: "cancellation" }],
        ])
      );

      const output = VMTestCase.new()
        .input(startMessage(3, { id: invocationId }))
        .input(inputEntryMessage("my-data"))
        // Then we have a sleep that is already completed
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 2,
          })
        )
        .input(
          notification(MessageType.SleepCompletionNotification, {
            completion_id: 2,
            void: VOID,
          })
        )
        .run((vm) => {
          vm.sysInput();

          // Simulating the user code to be:
          //
          // await awakeable()
          // await sleep()
          //
          // But this journal could have been created only with the following code:
          // awakeable()
          // await sleep()
          //
          // Otherwise the notification for the awakeable should be in the journal before the second awakeable!

          const awakeableHandle = vm.sysAwakeable().handle;

          // On await, this is the expected error
          expectErrorEquals(
            expectVMError(() => vm.doAwait({ Single: awakeableHandle })),
            expectedError
          );
        });

      expectErrorMessageAsError(
        output.nextDecoded(ErrorMessageDef),
        expectedError
      );
      output.expectEnd();
    });
  });
});
