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
  ErrorBehavior,
  MessageType,
  ProposeRunCompletionAckMessageDesc,
  RunCommand,
  SleepCommand,
  StartMessageDesc,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  codes,
  saturatingMillisToU64,
  VMError,
} from "../../src/endpoint/handlers/vm/ts/errors.js";
import {
  OnMaxAttempts,
  RETRY_POLICY_INFINITE,
  RETRY_POLICY_NONE,
  type RetryPolicy,
} from "../../src/endpoint/handlers/vm/ts/retries.js";
import { VMState } from "../../src/endpoint/handlers/vm/ts/types.js";
import { Decoder } from "../../src/endpoint/handlers/vm/ts/encoding.js";
import {
  AwaitingOnMessageDef,
  b,
  EndMessageDef,
  ErrorMessageDef,
  expectErrorMessageAsError,
  expectFailure,
  expectOutputWithFailure,
  expectOutputWithSuccess,
  expectSuccess,
  expectSuspended,
  expectSuspendedWaitingCompletion,
  expectVMError,
  inputEntryMessage,
  mockInit,
  msg,
  notification,
  OutputCommandMessageDef,
  ProposeRunCompletionMessageDef,
  startMessage,
  SuspensionMessageDef,
  Version,
  VMTestCase,
} from "./testutils.js";

const start = (knownEntries: number, extra: object = {}) =>
  msg(MessageType.Start, StartMessageDesc, {
    id: b("123"),
    debug_id: "123",
    known_entries: knownEntries,
    partial_state: false,
    ...extra,
  });

describe("run", () => {
  it("enter then propose completion then suspend", () => {
    const output = VMTestCase.new()
      .input(start(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);

        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "executeRun",
          handle,
        });
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: true,
        });

        vm.proposeRunCompletion(
          handle,
          { type: "success", value: b("123") },
          RETRY_POLICY_INFINITE
        );

        // Not yet closed, we could still receive the completion here
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        // Input closed, we won't receive the ack anymore
        vm.notifyInputClosed();
        expectSuspended(() => vm.doAwait({ Single: handle }));
      });

    expect(output.nextDecoded(RunCommand)).toEqual(
      create(RunCommand.desc, {
        result_completion_id: 1,
        name: "my-side-effect",
      })
    );
    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: b("123"),
      failure: undefined,
    });
    expect(output.nextDecoded(AwaitingOnMessageDef)).toEqual({
      awaiting_on: {
        waiting_completions: [1],
        waiting_signals: [1],
        waiting_named_signals: [],
        nested_futures: [],
        combinator_type: CombinatorType.FirstCompleted,
      },
      executing_side_effects: false,
    });
    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("enter then propose completion then complete", () => {
    const output = VMTestCase.withVersion(Version.V6)
      .input(start(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "executeRun",
          handle,
        });

        // This should not generate AwaitingOnMessage
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: true,
        });

        vm.proposeRunCompletion(
          handle,
          { type: "success", value: b("123") },
          RETRY_POLICY_INFINITE
        );

        // This will generate AwaitingOnMessage
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        vm.notifyInput(
          notification(MessageType.RunCompletionNotification, {
            completion_id: 1,
            value: { content: b("123") },
          }).bytes
        );
        vm.notifyInputClosed();

        // We should now get the side effect result
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "anyCompleted",
        });
        const s = expectSuccess(vm.takeNotification(handle));

        // Write the result as output
        vm.sysWriteOutput({ type: "success", value: s });
        vm.sysEnd();
      });

    expect(output.nextDecoded(RunCommand)).toEqual(
      create(RunCommand.desc, {
        name: "my-side-effect",
        result_completion_id: 1,
      })
    );
    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: b("123"),
      failure: undefined,
    });
    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "123");
    output.nextDecoded(EndMessageDef);
    output.expectEnd();
  });

  it("enter then propose completion then complete with failure", () => {
    const output = VMTestCase.withVersion(Version.V6)
      .input(start(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);

        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "executeRun",
          handle,
        });
        vm.proposeRunCompletion(
          handle,
          {
            type: "terminalFailure",
            failure: { code: 500, message: "my-failure", metadata: [] },
          },
          RETRY_POLICY_INFINITE
        );

        vm.notifyInput(
          notification(MessageType.RunCompletionNotification, {
            completion_id: 1,
            failure: { code: 500, message: "my-failure", metadata: [] },
          }).bytes
        );
        vm.notifyInputClosed();

        // We should now get the side effect result
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "anyCompleted",
        });
        const f = expectFailure(vm.takeNotification(handle));

        // Write the result as output
        vm.sysWriteOutput({ type: "failure", failure: f });
        vm.sysEnd();
      });

    expect(output.nextDecoded(RunCommand)).toEqual(
      create(RunCommand.desc, {
        result_completion_id: 1,
        name: "my-side-effect",
      })
    );
    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: undefined,
      failure: { code: 500, message: "my-failure", metadata: [] },
    });
    expectOutputWithFailure(
      output.nextDecoded(OutputCommandMessageDef),
      500,
      "my-failure"
    );
    output.nextDecoded(EndMessageDef);
    output.expectEnd();
  });

  it("enter then notify input closed then propose completion", () => {
    const output = VMTestCase.new()
      .input(start(1))
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "executeRun",
          handle,
        });

        // Notify input closed here
        vm.notifyInputClosed();

        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "waitingExternalProgress",
          waitingInput: false,
          waitingRunProposal: true,
        });

        // Propose run completion
        vm.proposeRunCompletion(
          handle,
          { type: "success", value: b("123") },
          RETRY_POLICY_INFINITE
        );

        expectSuspended(() => vm.doAwait({ Single: handle }));
      });

    expect(output.nextDecoded(RunCommand)).toEqual(
      create(RunCommand.desc, {
        name: "my-side-effect",
        result_completion_id: 1,
      })
    );
    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: b("123"),
      failure: undefined,
    });
    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("replay without completion", () => {
    const output = VMTestCase.new()
      .input(startMessage(2))
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.RunCommand, RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      )
      .run((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);

        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "executeRun",
          handle,
        });
        vm.proposeRunCompletion(
          handle,
          { type: "success", value: b("123") },
          RETRY_POLICY_INFINITE
        );

        expectSuspended(() => vm.doAwait({ Single: handle }));
      });

    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: b("123"),
      failure: undefined,
    });
    expectSuspendedWaitingCompletion(
      output.nextDecoded(SuspensionMessageDef),
      1
    );
    output.expectEnd();
  });

  it("replay without completion with any", () => {
    const output = VMTestCase.new()
      .input(startMessage(5))
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.RunCommand, RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      )
      .input(
        msg(MessageType.SleepCommand, SleepCommand.desc, {
          wake_up_time: 0n,
          result_completion_id: 2,
        })
      )
      .input(
        msg(MessageType.SleepCommand, SleepCommand.desc, {
          wake_up_time: 0n,
          result_completion_id: 3,
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

        const { replayed, handle: runHandle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);
        const firstSleepHandle = vm.sysSleep("", 0n);

        // await any(run, first_sleep), we're still replaying here!
        expect(
          vm.doAwait({
            FirstCompleted: [
              { Single: runHandle },
              { Single: firstSleepHandle },
            ],
          })
        ).toEqual({ type: "anyCompleted" });
        expect(vm.state()).toBe(VMState.Replaying);

        // Now we try to run!
        const secondSleepHandle = vm.sysSleep("", 0n);
        expect(vm.state()).toBe(VMState.Processing);
        expect(
          vm.doAwait({
            FirstCompleted: [
              { Single: runHandle },
              { Single: secondSleepHandle },
            ],
          })
        ).toEqual({ type: "executeRun", handle: runHandle });

        vm.proposeRunCompletion(
          runHandle,
          { type: "success", value: b("123") },
          RETRY_POLICY_INFINITE
        );

        expectSuspended(() =>
          vm.doAwait({
            FirstCompleted: [
              { Single: runHandle },
              { Single: secondSleepHandle },
            ],
          })
        );
      });

    expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
      result_completion_id: 1,
      value: b("123"),
      failure: undefined,
    });
    // Cancel signal wraps the original future: FirstCompleted([original, cancel])
    const suspension = output.nextDecoded(SuspensionMessageDef)!;
    expect(suspension.awaiting_on!.waiting_completions).toEqual([]);
    expect(suspension.awaiting_on!.waiting_signals).toEqual([1]);
    expect(suspension.awaiting_on!.waiting_named_signals).toEqual([]);
    expect(suspension.awaiting_on!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    expect(suspension.awaiting_on!.nested_futures).toHaveLength(1);
    const nested = suspension.awaiting_on!.nested_futures[0]!;
    expect([...nested.waiting_completions].sort()).toEqual([1, 3]);
    expect(nested.waiting_signals).toEqual([]);
    expect(nested.waiting_named_signals).toEqual([]);
    expect(nested.nested_futures).toEqual([]);
    expect(nested.combinator_type).toBe(CombinatorType.FirstCompleted);
    output.expectEnd();
  });

  it("replay with completion", () => {
    const output = VMTestCase.new()
      .input(startMessage(3))
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.RunCommand, RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      )
      .input(
        notification(MessageType.RunCompletionNotification, {
          completion_id: 1,
          value: { content: b("123") },
        })
      )
      .run((vm) => {
        vm.sysInput();

        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(true);
        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "anyCompleted",
        });

        // We should now get the side effect result
        const s = expectSuccess(vm.takeNotification(handle));

        // Write the result as output
        vm.sysWriteOutput({ type: "success", value: s });
        vm.sysEnd();
      });

    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "123");
    output.nextDecoded(EndMessageDef);
    output.expectEnd();
  });

  it("replay with completion followed by another command is replayed", () => {
    const output = VMTestCase.new()
      .input(startMessage(4))
      .input(inputEntryMessage("my-data"))
      .input(
        msg(MessageType.RunCommand, RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      )
      .input(
        msg(MessageType.SleepCommand, SleepCommand.desc, {
          wake_up_time: 0n,
          result_completion_id: 2,
        })
      )
      .input(
        notification(MessageType.RunCompletionNotification, {
          completion_id: 1,
          value: { content: b("123") },
        })
      )
      .run((vm) => {
        vm.sysInput();

        // We're still replaying and the run completion is already buffered,
        // so the closure must NOT be executed.
        const { replayed, handle } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(true);
        expect(vm.state()).toBe(VMState.Replaying);

        // Replay the trailing command too.
        vm.sysSleep("", 0n);

        expect(vm.doAwait({ Single: handle })).toEqual({
          type: "anyCompleted",
        });
        const s = expectSuccess(vm.takeNotification(handle));

        vm.sysWriteOutput({ type: "success", value: s });
        vm.sysEnd();
      });

    // The run was replayed: no RunCommand nor ProposeRunCompletion is emitted.
    expectOutputWithSuccess(output.nextDecoded(OutputCommandMessageDef), "123");
    output.nextDecoded(EndMessageDef);
    output.expectEnd();
  });

  it("enter then notify error", () => {
    const output = VMTestCase.new()
      .input(startMessage(1))
      .input(inputEntryMessage("my-data"))
      .run((vm) => {
        vm.sysInput();

        const { replayed } = vm.sysRun("my-side-effect");
        expect(replayed).toBe(false);

        vm.notifyError(
          VMError.internal("my-error").withStacktrace("my-error-description"),
          undefined
        );
      });

    expect(output.nextDecoded(RunCommand)).toEqual(
      create(RunCommand.desc, {
        result_completion_id: 1,
        name: "my-side-effect",
      })
    );
    expectErrorMessageAsError(
      output.nextDecoded(ErrorMessageDef),
      new VMError(500, "my-error").withStacktrace("my-error-description")
    );
    output.expectEnd();
  });

  // Tests for the protocol v7 ProposeRunCompletionAck flow.
  describe("v7 with ack", () => {
    const ack = (completionId: number) =>
      msg(
        MessageType.ProposeRunCompletionAck,
        ProposeRunCompletionAckMessageDesc,
        {
          completion_id: completionId,
        }
      );

    it("propose then receive ack completes with success", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("my-data"))
        .runWithoutClosingInput((vm) => {
          vm.sysInput();

          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "executeRun",
            handle,
          });

          vm.proposeRunCompletion(
            handle,
            { type: "success", value: b("result") },
            RETRY_POLICY_INFINITE
          );

          // Still waiting for the ack from the runtime
          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "waitingExternalProgress",
            waitingInput: true,
            waitingRunProposal: false,
          });

          // Runtime sends the ack — result was cached at proposal time
          vm.notifyInput(ack(1).bytes);

          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "anyCompleted",
          });
          const s = expectSuccess(vm.takeNotification(handle));

          vm.sysWriteOutput({ type: "success", value: s });
          vm.sysEnd();
        });

      expect(output.nextDecoded(RunCommand)).toEqual(
        create(RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      );
      const propose = output.nextWithHeaderDecoded(
        ProposeRunCompletionMessageDef
      )!;
      expect(propose.header.requestedAck).toBe(true);
      expect(propose.msg).toEqual({
        result_completion_id: 1,
        value: b("result"),
        failure: undefined,
      });
      expect(output.nextDecoded(AwaitingOnMessageDef)).toMatchObject({
        awaiting_on: {
          waiting_completions: [1],
          waiting_signals: [1],
          combinator_type: CombinatorType.FirstCompleted,
        },
        executing_side_effects: false,
      });
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "result"
      );
      output.nextDecoded(EndMessageDef);
      output.expectEnd();
    });

    it("propose then receive ack completes with failure", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("my-data"))
        .runWithoutClosingInput((vm) => {
          vm.sysInput();

          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "executeRun",
            handle,
          });

          vm.proposeRunCompletion(
            handle,
            {
              type: "terminalFailure",
              failure: {
                code: 500,
                message: "side-effect-error",
                metadata: [],
              },
            },
            RETRY_POLICY_INFINITE
          );

          // Runtime sends the ack
          vm.notifyInput(ack(1).bytes);

          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "anyCompleted",
          });
          const f = expectFailure(vm.takeNotification(handle));

          vm.sysWriteOutput({ type: "failure", failure: f });
          vm.sysEnd();
        });

      expect(output.nextDecoded(RunCommand)).toEqual(
        create(RunCommand.desc, {
          result_completion_id: 1,
          name: "my-side-effect",
        })
      );
      const propose = output.nextWithHeaderDecoded(
        ProposeRunCompletionMessageDef
      )!;
      expect(propose.header.requestedAck).toBe(true);
      expect(propose.msg).toEqual({
        result_completion_id: 1,
        value: undefined,
        failure: { code: 500, message: "side-effect-error", metadata: [] },
      });
      // No AwaitingOnMessage: do_await was never called between propose and ack
      expectOutputWithFailure(
        output.nextDecoded(OutputCommandMessageDef),
        500,
        "side-effect-error"
      );
      output.nextDecoded(EndMessageDef);
      output.expectEnd();
    });

    it("ack with unknown completion id errors", () => {
      const output = VMTestCase.new()
        .input(start(1))
        .input(inputEntryMessage("my-data"))
        .runWithoutClosingInput((vm) => {
          vm.sysInput();

          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "executeRun",
            handle,
          });

          vm.proposeRunCompletion(
            handle,
            { type: "success", value: b("result") },
            RETRY_POLICY_INFINITE
          );

          // Runtime sends ack with a completion_id we never proposed
          vm.notifyInput(ack(99).bytes);
        });

      output.nextDecoded(RunCommand);
      const propose = output.nextWithHeaderDecoded(
        ProposeRunCompletionMessageDef
      )!;
      expect(propose.header.requestedAck).toBe(true);
      // No AwaitingOnMessage: do_await was not called between propose and the bad ack
      expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
        code: codes.PROTOCOL_VIOLATION,
      });
      output.expectEnd();
    });

    it("ack during replay is unexpected", () => {
      // Feed the ack while the VM is still replaying (known_entries=3 but only 2 replayed).
      const testCase = VMTestCase.new()
        .input(start(3))
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.RunCommand, RunCommand.desc, {
            result_completion_id: 1,
            name: "my-side-effect",
          })
        )
        // This is fed as if it were the third journal entry, but it is not a valid
        // journal entry — the runtime must never send ProposeRunCompletionAckMessage
        // during the replay phase.
        .input(ack(1));

      // The VM should have transitioned to an error state. Drain any buffered output.
      const decoder = new Decoder();
      for (;;) {
        const out = testCase.vm.takeOutput();
        if (out.length === 0) {
          break;
        }
        decoder.push(out);
      }
      const raw = [];
      for (;;) {
        const m = decoder.consumeNext();
        if (m === undefined) {
          break;
        }
        raw.push(m);
      }
      const last = raw.pop()!;
      const errorMsg = last.decodeTo(ErrorMessageDef, 0);
      expect(errorMsg.code).not.toBe(0);
    });
  });

  describe("retry policy", () => {
    const retryableFailure = (attemptDuration: number) => ({
      type: "retryableFailure" as const,
      error: VMError.internal("my-error").withStacktrace("my-stacktrace"),
      attemptDuration,
    });

    function testShouldStopRetrying(
      retryCountSinceLastStoredEntry: number,
      durationSinceLastStoredEntry: number,
      attemptDuration: number,
      retryPolicy: RetryPolicy
    ) {
      const output = VMTestCase.new()
        .input(
          startMessage(2, {
            retry_count_since_last_stored_entry: retryCountSinceLastStoredEntry,
            duration_since_last_stored_entry: BigInt(
              durationSinceLastStoredEntry
            ),
          })
        )
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.RunCommand, RunCommand.desc, {
            result_completion_id: 1,
            name: "my-side-effect",
          })
        )
        .runWithoutClosingInput((vm) => {
          vm.sysInput();

          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          vm.proposeRunCompletion(
            handle,
            retryableFailure(attemptDuration),
            retryPolicy
          );

          vm.notifyInput(
            notification(MessageType.RunCompletionNotification, {
              completion_id: 1,
              failure: { code: 500, message: "my-error", metadata: [] },
            }).bytes
          );
          vm.notifyInputClosed();

          expect(vm.doAwait({ Single: handle })).toEqual({
            type: "anyCompleted",
          });
          const value = vm.takeNotification(handle)!;

          // Write the result as output
          if (typeof value === "object" && "Success" in value) {
            vm.sysWriteOutput({ type: "success", value: value.Success });
          } else if (typeof value === "object" && "Failure" in value) {
            vm.sysWriteOutput({ type: "failure", failure: value.Failure });
          } else {
            throw new Error(`Unexpected value ${JSON.stringify(value)}`);
          }
          vm.sysEnd();
        });

      expect(output.nextDecoded(ProposeRunCompletionMessageDef)).toEqual({
        result_completion_id: 1,
        value: undefined,
        failure: { code: 500, message: "my-error", metadata: [] },
      });
      expectOutputWithFailure(
        output.nextDecoded(OutputCommandMessageDef),
        500,
        "my-error"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    }

    function testShouldContinueRetrying(
      retryCountSinceLastStoredEntry: number,
      durationSinceLastStoredEntry: number,
      attemptDuration: number,
      retryPolicy: RetryPolicy,
      nextRetryInterval: number | undefined
    ) {
      const output = VMTestCase.new()
        .input(
          startMessage(2, {
            retry_count_since_last_stored_entry: retryCountSinceLastStoredEntry,
            duration_since_last_stored_entry: BigInt(
              durationSinceLastStoredEntry
            ),
          })
        )
        .input(inputEntryMessage("my-data"))
        // Replay the RunCommand as a known entry so that `infer_entry_retry_info`
        // is used and the policy sees `retry_count_since_last_stored_entry + 1`.
        .input(
          msg(MessageType.RunCommand, RunCommand.desc, {
            result_completion_id: 1,
            name: "my-side-effect",
          })
        )
        .run((vm) => {
          vm.sysInput();
          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          expectVMError(() =>
            vm.proposeRunCompletion(
              handle,
              retryableFailure(attemptDuration),
              retryPolicy
            )
          );
        });

      expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
        code: 500,
        message: "my-error",
        next_retry_delay:
          nextRetryInterval !== undefined
            ? saturatingMillisToU64(nextRetryInterval)
            : undefined,
        stacktrace: "my-stacktrace",
      });
      output.expectEnd();
    }

    const exponential = (
      maxAttempts: number | undefined,
      maxDuration: number | undefined,
      factor = 1.0,
      onMaxAttempts = OnMaxAttempts.FailAsTerminal
    ): RetryPolicy => ({
      type: "exponential",
      initialInterval: 1000,
      factor,
      maxAttempts,
      maxDuration,
      maxInterval: undefined,
      onMaxAttempts,
    });

    it("exit with retryable error saturates out of bounds next retry delay", () => {
      testShouldContinueRetrying(
        0,
        0,
        0,
        {
          type: "fixedDelay",
          interval: Infinity,
          onMaxAttempts: OnMaxAttempts.FailAsTerminal,
        },
        Infinity
      );
    });

    it("exit with retryable error no retry policy", () => {
      testShouldContinueRetrying(0, 0, 0, RETRY_POLICY_INFINITE, undefined);
    });

    it.each([
      [0, 0],
      [0, 1],
      [1, 2],
      [2, 2],
      [2, 1],
      [2, 0],
      [99, 100],
    ])(
      "should stop retrying with retry count %i and max attempts %i",
      (retryCountSinceLastStoredEntry, maxAttempts) => {
        testShouldStopRetrying(
          retryCountSinceLastStoredEntry,
          1000,
          1000,
          exponential(maxAttempts, undefined)
        );
      }
    );

    it.each([
      [0, 2],
      [1, 3],
      [99, 101],
    ])(
      "should continue retrying with retry count %i and max attempts %i",
      (retryCountSinceLastStoredEntry, maxAttempts) => {
        testShouldContinueRetrying(
          retryCountSinceLastStoredEntry,
          0,
          0,
          exponential(maxAttempts, undefined),
          1000
        );
      }
    );

    it("exit with retryable error retry policy duration", () => {
      testShouldStopRetrying(0, 0, 1000, exponential(undefined, 1000));
    });

    it("exit with retryable error retry policy none", () => {
      testShouldStopRetrying(0, 0, 0, RETRY_POLICY_NONE);
    });

    it("exit with retryable error retry policy fixed", () => {
      testShouldContinueRetrying(
        0,
        0,
        0,
        {
          type: "fixedDelay",
          interval: 1000,
          onMaxAttempts: OnMaxAttempts.FailAsTerminal,
        },
        1000
      );
    });

    it("exit with retryable error retry policy exhausted max duration", () => {
      testShouldStopRetrying(1, 1000, 1000, {
        type: "fixedDelay",
        interval: 1000,
        maxDuration: 2000,
        onMaxAttempts: OnMaxAttempts.FailAsTerminal,
      });
    });

    it("exit with retryable error retry policy exhausted max attempts", () => {
      testShouldStopRetrying(9, 1000, 1000, {
        type: "fixedDelay",
        interval: 1000,
        maxAttempts: 10,
        onMaxAttempts: OnMaxAttempts.FailAsTerminal,
      });
    });

    it("exit with retryable error retry policy exhausted max attempts 0", () => {
      testShouldStopRetrying(0, 1000, 1000, exponential(0, undefined));
    });

    it("exit with retryable error retry policy exhausted max attempts 1", () => {
      testShouldStopRetrying(1, 1000, 1000, exponential(0, undefined));
    });

    it("retry info is zero when entry is the one after the first new entry", () => {
      const output = VMTestCase.new()
        .input(
          startMessage(1, {
            retry_count_since_last_stored_entry: 10,
            duration_since_last_stored_entry: 10_000n,
          })
        )
        .input(inputEntryMessage("my-data"))
        .run((vm) => {
          vm.sysInput();

          // Just create another journal entry
          vm.sysSleep("", 100_000n);

          // Now try to enter run
          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);

          expectVMError(() =>
            vm.proposeRunCompletion(
              handle,
              {
                type: "retryableFailure",
                error: VMError.internal("my-error"),
                attemptDuration: 99,
              },
              {
                type: "fixedDelay",
                interval: 1000,
                maxAttempts: 2,
                maxDuration: 100,
                onMaxAttempts: OnMaxAttempts.FailAsTerminal,
              }
            )
          );
        });

      output.nextDecoded(SleepCommand);
      expect(output.nextDecoded(RunCommand)).toEqual(
        create(RunCommand.desc, {
          result_completion_id: 2,
          name: "my-side-effect",
        })
      );
      expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
        code: 500,
        message: "my-error",
        next_retry_delay: 1000n,
      });
      output.expectEnd();
    });

    function testShouldPauseOnExhaustion(
      retryCountSinceLastStoredEntry: number,
      durationSinceLastStoredEntry: number,
      attemptDuration: number,
      retryPolicy: RetryPolicy
    ) {
      const output = VMTestCase.new()
        .input(
          startMessage(2, {
            retry_count_since_last_stored_entry: retryCountSinceLastStoredEntry,
            duration_since_last_stored_entry: BigInt(
              durationSinceLastStoredEntry
            ),
          })
        )
        .input(inputEntryMessage("my-data"))
        .input(
          msg(MessageType.RunCommand, RunCommand.desc, {
            result_completion_id: 1,
            name: "my-side-effect",
          })
        )
        .run((vm) => {
          vm.sysInput();
          const { replayed, handle } = vm.sysRun("my-side-effect");
          expect(replayed).toBe(false);
          expectVMError(() =>
            vm.proposeRunCompletion(
              handle,
              retryableFailure(attemptDuration),
              retryPolicy
            )
          );
        });

      expect(output.nextDecoded(ErrorMessageDef)).toMatchObject({
        code: 500,
        message: "my-error",
        stacktrace: "my-stacktrace",
        behavior: ErrorBehavior.Pause,
        next_retry_delay: undefined,
      });
      output.expectEnd();
    }

    it("exit with retryable error fixed delay pause on max attempts", () => {
      testShouldPauseOnExhaustion(9, 1000, 1000, {
        type: "fixedDelay",
        interval: 1000,
        maxAttempts: 10,
        onMaxAttempts: OnMaxAttempts.Pause,
      });
    });

    it("exit with retryable error fixed delay pause on max duration", () => {
      testShouldPauseOnExhaustion(1, 1000, 1000, {
        type: "fixedDelay",
        interval: 1000,
        maxDuration: 2000,
        onMaxAttempts: OnMaxAttempts.Pause,
      });
    });

    it("exit with retryable error exponential pause on max attempts", () => {
      testShouldPauseOnExhaustion(
        0,
        1000,
        1000,
        exponential(0, undefined, 1.0, OnMaxAttempts.Pause)
      );
    });

    it("propose run completion with pause policy on v6 returns unsupported feature", () => {
      const vm = mockInit(Version.V6);
      vm.notifyInput(startMessage(1).bytes);
      vm.notifyInput(inputEntryMessage("my-data").bytes);
      vm.notifyInputClosed();
      vm.sysInput();
      const { replayed, handle } = vm.sysRun("my-side-effect");
      expect(replayed).toBe(false);

      const err = expectVMError(() =>
        vm.proposeRunCompletion(
          handle,
          {
            type: "retryableFailure",
            error: VMError.internal("my-error"),
            attemptDuration: 0,
          },
          {
            type: "fixedDelay",
            interval: 1000,
            maxAttempts: 1,
            onMaxAttempts: OnMaxAttempts.Pause,
          }
        )
      );

      expect(err.code).toBe(codes.UNSUPPORTED_FEATURE);
    });

    it("exit with retryable error exponential overflow saturates", () => {
      // Policy sees retry_count = 70 + 1 = 71 => 1s * 2^70, well past the ~2^64
      // overflow boundary, so the policy saturates to Duration::MAX, whose millis
      // saturate to u64::MAX in the emitted ErrorMessage.
      testShouldContinueRetrying(
        70,
        0,
        0,
        exponential(undefined, undefined, 2.0),
        Infinity
      );
    });

    it("exit with retryable error exponential millis do not wrap to zero", () => {
      // Policy sees retry_count = 62 + 1 = 63 => 1s * 2^62.
      testShouldContinueRetrying(
        62,
        0,
        0,
        exponential(undefined, undefined, 2.0),
        2 ** 62 * 1000
      );
    });
  });
});
