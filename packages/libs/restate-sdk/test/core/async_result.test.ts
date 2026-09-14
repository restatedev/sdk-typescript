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
import { Decoder } from "../../src/endpoint/handlers/vm/ts/encoding.js";
import {
  CallCommand,
  CombinatorType,
  InputCommandMessageDesc,
  MessageType,
  SetStateCommand,
  SleepCommand,
  StartMessageDesc,
  VOID,
} from "../../src/endpoint/handlers/vm/ts/messages.js";
import { create } from "../../src/endpoint/handlers/vm/ts/proto.js";
import {
  defaultVMOptions,
  type Target,
} from "../../src/endpoint/handlers/vm/ts/types.js";
import type { WasmUnresolvedFuture } from "../../src/endpoint/handlers/vm/types.js";
import {
  AwaitingOnMessageDef,
  b,
  emptySignalNotification,
  EndMessageDef,
  expectClosed,
  expectOutputWithSuccess,
  expectSuccess,
  expectSuspended,
  expectSuspendedWaitingCompletion,
  expectSuspendedWaitingSignal,
  inputEntryMessage,
  isSuspendedWhen,
  mockInit,
  msg,
  notification,
  OutputCommandMessageDef,
  startMessage,
  SuspensionMessageDef,
  VMTestCase,
} from "./testutils.js";

const greeterTarget = (): Target => ({
  service: "Greeter",
  handler: "greeter",
  headers: [],
});

// Future builders (numbers are handles, or 0-based indices in AwaitTest)
type F = WasmUnresolvedFuture | number;
const s = (f: F): WasmUnresolvedFuture =>
  typeof f === "number" ? { Single: f } : f;
const fc = (...c: F[]): WasmUnresolvedFuture => ({ FirstCompleted: c.map(s) });
const ac = (...c: F[]): WasmUnresolvedFuture => ({ AllCompleted: c.map(s) });
const fsaf = (...c: F[]): WasmUnresolvedFuture => ({
  FirstSucceededOrAllFailed: c.map(s),
});
const asff = (...c: F[]): WasmUnresolvedFuture => ({
  AllSucceededOrFirstFailed: c.map(s),
});
const unk = (...c: F[]): WasmUnresolvedFuture => ({ Unknown: c.map(s) });

describe("async results", () => {
  it("dont await call", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
      .run((vm) => {
        vm.sysInput();

        vm.sysCall(greeterTarget(), b("Francesco"), undefined);
        vm.sysWriteOutput({ type: "success", value: b("Whatever") });
        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toEqual(
      create(CallCommand.desc, {
        service_name: "Greeter",
        handler_name: "greeter",
        parameter: b("Francesco"),
        invocation_id_notification_idx: 1,
        result_completion_id: 2,
      })
    );
    expectOutputWithSuccess(
      output.nextDecoded(OutputCommandMessageDef),
      "Whatever"
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("dont await call dont notify input closed", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();
        vm.sysCall(greeterTarget(), b("Francesco"), undefined);
        vm.sysWriteOutput({ type: "success", value: b("Whatever") });
        vm.sysEnd();
      });

    expect(output.nextDecoded(CallCommand)).toEqual(
      create(CallCommand.desc, {
        service_name: "Greeter",
        handler_name: "greeter",
        parameter: b("Francesco"),
        invocation_id_notification_idx: 1,
        result_completion_id: 2,
      })
    );
    expectOutputWithSuccess(
      output.nextDecoded(OutputCommandMessageDef),
      "Whatever"
    );
    expect(output.nextDecoded(EndMessageDef)).toEqual({});
    output.expectEnd();
  });

  it("await twice the same handle", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const h = vm.sysAwakeable().handle;

        expect(vm.doAwait(s(h))).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });
        expect(vm.doAwait(s(h))).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        vm.notifyInputClosed();

        expectSuspended(() => vm.doAwait(s(h)));
      });

    // Two do_progress calls returned WaitingExternalProgress, each emits AwaitingOnMessage
    // The future is FirstCompleted([Single(signal_17), Single(cancel_signal)])
    for (let i = 0; i < 2; i++) {
      const awaitingOn = output.nextDecoded(AwaitingOnMessageDef)!;
      expect(awaitingOn.executing_side_effects).toBe(false);
      expect([...awaitingOn.awaiting_on!.waiting_signals].sort()).toEqual([
        1, 17,
      ]);
      expect(awaitingOn.awaiting_on!.waiting_completions).toEqual([]);
      expect(awaitingOn.awaiting_on!.waiting_named_signals).toEqual([]);
      expect(awaitingOn.awaiting_on!.nested_futures).toEqual([]);
      expect(awaitingOn.awaiting_on!.combinator_type).toBe(
        CombinatorType.FirstCompleted
      );
    }
    expectSuspendedWaitingSignal(output.nextDecoded(SuspensionMessageDef), 17);
    output.expectEnd();
  });

  describe("do await", () => {
    // Little tool to test do_await
    class AwaitTest {
      readonly vm: CoreVM;
      private readonly decoder = new Decoder();
      readonly handles: number[] = [];
      private readonly taken = new Set<number>();

      private constructor(n: number) {
        this.vm = mockInit(undefined, {
          ...defaultVMOptions(),
          // We test implicit cancellation elsewhere, let's disable it here to keep these tests simple.
          implicitCancellation: { type: "disabled" },
        });

        this.vm.notifyInput(
          msg(MessageType.Start, StartMessageDesc, {
            id: b("123"),
            debug_id: "123",
            known_entries: 1,
          }).bytes
        );
        this.vm.notifyInput(inputEntryMessage("test").bytes);
        expect(this.vm.isReadyToExecute()).toBe(true);
        this.vm.sysInput();

        for (let i = 0; i < n; i++) {
          this.handles.push(this.vm.sysAwakeable().handle);
        }
      }

      static givenNFutures(n: number): AwaitTest {
        return new AwaitTest(n);
      }

      /** Send void notifications for the given 0-based handle indices. */
      givenNotify(indices: number[]): this {
        for (const i of indices) {
          this.vm.notifyInput(emptySignalNotification(17 + i).bytes);
        }
        return this;
      }

      /** Send failure notifications for the given 0-based handle indices. */
      givenNotifyFailure(indices: number[]): this {
        for (const i of indices) {
          this.vm.notifyInput(
            notification(MessageType.SignalNotification, {
              signal_id: 17 + i,
              failure: { code: 0, message: "", metadata: [] },
            }).bytes
          );
        }
        return this;
      }

      givenInputClosed(): this {
        this.vm.notifyInputClosed();
        return this;
      }

      private drainOutput() {
        for (;;) {
          const out = this.vm.takeOutput();
          if (out.length === 0) {
            break;
          }
          this.decoder.push(out);
        }
      }

      whenAwaitThenSuspended(
        awaitOn: WasmUnresolvedFuture,
        reduced: WasmUnresolvedFuture
      ) {
        awaitOn = this.translateToHandles(awaitOn);
        reduced = this.translateToHandles(reduced);
        const expectedSuspension = {
          awaiting_on: this.vm.resolveUnresolvedFuture(reduced),
        };

        // This should not perform any mutations.
        expectSuspended(() => this.vm.doAwait(awaitOn));
        this.drainOutput();

        const raw = this.decoder.consumeNext();
        expect(raw, "there must be one message").toBeDefined();
        expect(raw!.ty).toBe(MessageType.Suspension);
        expect(raw!.decodeTo(SuspensionMessageDef, 0)).toEqual(
          expectedSuspension
        );
      }

      /** The `awaitOn` future is the one we provide to do_await, the `reduced` future is the one we expect to be in AwaitingOnMessage. */
      whenAwaitThenAwaitingOn(
        awaitOn: WasmUnresolvedFuture,
        reduced: WasmUnresolvedFuture
      ): this {
        awaitOn = this.translateToHandles(awaitOn);
        reduced = this.translateToHandles(reduced);
        const expectedAwaitingOn = {
          awaiting_on: this.vm.resolveUnresolvedFuture(reduced),
          executing_side_effects: false,
        };

        // This should not perform any mutations.
        expect(this.vm.doAwait(awaitOn)).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });
        this.drainOutput();

        const raw = this.decoder.consumeNext();
        expect(raw, "there must be one message").toBeDefined();
        expect(raw!.ty).toBe(MessageType.AwaitingOn);
        expect(raw!.decodeTo(AwaitingOnMessageDef, 0)).toEqual(
          expectedAwaitingOn
        );
        return this;
      }

      /** Await a future, assert `AnyCompleted`. This simulates what `tryComplete()` would do in the SDK. */
      whenAwaitThenCompleted(fut: WasmUnresolvedFuture): this {
        fut = this.translateToHandles(fut);
        expect(this.vm.doAwait(fut)).toEqual({ type: "anyCompleted" });
        return this;
      }

      /** Just checks the completed handles. */
      expectCompleted(completedIndices: number[]): this {
        for (const [i, h] of this.handles.entries()) {
          if (this.taken.has(i)) {
            continue;
          }
          if (completedIndices.includes(i)) {
            expect(
              this.vm.isCompleted(h),
              `expected h${i} to be completed`
            ).toBe(true);
          } else {
            expect(
              this.vm.isCompleted(h),
              `expected h${i} to NOT be completed`
            ).toBe(false);
          }
        }
        for (const i of completedIndices) {
          this.vm.takeNotification(this.handles[i]!);
          this.taken.add(i);
        }
        return this;
      }

      /** Translate a future tree built with raw 0-based indices into real handles. */
      private translateToHandles(
        fut: WasmUnresolvedFuture
      ): WasmUnresolvedFuture {
        const t = (f: WasmUnresolvedFuture): WasmUnresolvedFuture =>
          this.translateToHandles(f);
        if ("Single" in fut) {
          return { Single: this.handles[fut.Single]! };
        }
        if ("FirstCompleted" in fut) {
          return { FirstCompleted: fut.FirstCompleted.map(t) };
        }
        if ("AllCompleted" in fut) {
          return { AllCompleted: fut.AllCompleted.map(t) };
        }
        if ("FirstSucceededOrAllFailed" in fut) {
          return {
            FirstSucceededOrAllFailed: fut.FirstSucceededOrAllFailed.map(t),
          };
        }
        if ("AllSucceededOrFirstFailed" in fut) {
          return {
            AllSucceededOrFirstFailed: fut.AllSucceededOrFirstFailed.map(t),
          };
        }
        return { Unknown: fut.Unknown.map(t) };
      }
    }

    // first_completed!(0, 1) with replay [1, 0]
    it("first completed returns first resolved", () => {
      AwaitTest.givenNFutures(2)
        .whenAwaitThenAwaitingOn(fc(0, 1), fc(0, 1))
        .givenNotify([1, 0])
        .givenInputClosed()
        .whenAwaitThenCompleted(fc(0, 1))
        .expectCompleted([1]);
    });

    // all_completed!(first_completed!(0, 1), all_completed!(0, 1, 2)) with replay [1] then [0] then [2]
    it("nested all of first and all progressive", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          ac(fc(0, 1), ac(0, 1, 2)),
          ac(fc(0, 1), ac(0, 1, 2))
        )
        .givenNotify([1])
        .whenAwaitThenCompleted(ac(fc(0, 1), ac(0, 1, 2)))
        .expectCompleted([1])
        .whenAwaitThenAwaitingOn(ac(ac(0, 2)), ac(ac(0, 2)))
        .givenNotify([0])
        .whenAwaitThenAwaitingOn(ac(ac(0, 2)), ac(ac(2)))
        .expectCompleted([0])
        .givenNotify([2])
        .whenAwaitThenCompleted(ac(ac(2)))
        .expectCompleted([2]);
    });

    // all_completed!(first_completed!(0, 1), all_completed!(0, 1, 2)) with replay [1, 0, 2]
    it("nested all of first and all batch", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          ac(fc(0, 1), ac(0, 1, 2)),
          ac(fc(0, 1), ac(0, 1, 2))
        )
        .givenNotify([1, 0, 2])
        .whenAwaitThenCompleted(ac(fc(0, 1), ac(0, 1, 2)))
        .expectCompleted([1])
        .whenAwaitThenCompleted(ac(ac(0, 2)))
        .expectCompleted([0, 2]);
    });

    // all_completed!(first_completed!(0, 1), first_completed!(1, 2)) with replay [2, 1]
    it("all of two first completed disjoint", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(ac(fc(0, 1), fc(1, 2)), ac(fc(0, 1), fc(1, 2)))
        .givenNotify([2, 1])
        .whenAwaitThenCompleted(ac(fc(0, 1), fc(1, 2)))
        .expectCompleted([2])
        .whenAwaitThenCompleted(ac(fc(0, 1)))
        .expectCompleted([1]);
    });

    // all_completed!(first_completed!(0, 1), first_completed!(2, 1)) with replay [2, 1]
    it("all of two first completed shared handle outer resolves first", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(ac(fc(0, 1), fc(2, 1)), ac(fc(0, 1), fc(2, 1)))
        .givenNotify([2, 1])
        .whenAwaitThenCompleted(ac(fc(0, 1), fc(2, 1)))
        .expectCompleted([2])
        .whenAwaitThenCompleted(ac(fc(0, 1)))
        .expectCompleted([1]);
    });

    // all_completed!(first_completed!(0, 1), first_completed!(2, 1)) with replay [1, 0]
    it("all of two first completed shared handle resolves both", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(ac(fc(0, 1), fc(2, 1)), ac(fc(0, 1), fc(2, 1)))
        .givenNotify([1, 0])
        .whenAwaitThenCompleted(ac(fc(0, 1), fc(2, 1)))
        .expectCompleted([1]);
    });

    // all_completed!(0, 1) with replay [1]
    it("all completed partial resolution then suspends", () => {
      AwaitTest.givenNFutures(2)
        .givenNotify([1])
        .whenAwaitThenAwaitingOn(ac(0, 1), ac(0))
        .expectCompleted([1])
        .givenInputClosed()
        .whenAwaitThenSuspended(ac(0), ac(0));
    });

    // all_completed!(0, 1) with replay [1] and input closed before await
    it("all completed input closed before await", () => {
      AwaitTest.givenNFutures(2)
        .givenNotify([1])
        .givenInputClosed()
        .whenAwaitThenSuspended(ac(0, 1), ac(0));
    });

    // all_completed!(unknown!(0, 1), first_completed!(2, 1)) with replay [1, 0]
    it("all completed with unknown inner", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          ac(unk(0, 1), fc(2, 1)),
          ac(unk(0, 1), fc(2, 1))
        )
        .givenNotify([1, 0])
        .whenAwaitThenCompleted(ac(unk(0, 1), fc(2, 1)))
        .expectCompleted([1]);
    });

    // first_succeeded_or_all_failed!(unknown!(0, 1), first_completed!(2, 1)) with replay [1, 0]
    it("first succeeded or all failed with unknown inner", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          fsaf(unk(0, 1), fc(2, 1)),
          fsaf(unk(0, 1), fc(2, 1))
        )
        .givenNotify([1, 0])
        .whenAwaitThenCompleted(fsaf(unk(0, 1), fc(2, 1)))
        .expectCompleted([1]);
    });

    // all_succeeded_or_first_failed!(first_completed!(0, 1), first_completed!(2, 3)) with replay [failed 1]
    it("all succeeded or first failed short circuits on failure", () => {
      AwaitTest.givenNFutures(4)
        .whenAwaitThenAwaitingOn(
          asff(fc(0, 1), fc(2, 3)),
          asff(fc(0, 1), fc(2, 3))
        )
        .givenNotifyFailure([1, 0, 2, 3])
        .whenAwaitThenCompleted(asff(fc(0, 1), fc(2, 3)))
        .expectCompleted([1]);
    });

    // all_succeeded_or_first_failed!(all_completed!(0, 1), all_completed!(2, 3)) with replay [failed 1, failed 0]
    it("all succeeded or first failed inner all completed fully fails", () => {
      AwaitTest.givenNFutures(4)
        .whenAwaitThenAwaitingOn(
          asff(ac(0, 1), ac(2, 3)),
          asff(ac(0, 1), ac(2, 3))
        )
        .givenNotifyFailure([1, 0])
        .whenAwaitThenAwaitingOn(asff(ac(0, 1), ac(2, 3)), asff(ac(2, 3)))
        .expectCompleted([1, 0]);
    });

    // all_succeeded_or_first_failed!(all_completed!(0, 1), all_completed!(2, 3)) with replay [failed 1]
    it("all succeeded or first failed inner all completed partial failure", () => {
      AwaitTest.givenNFutures(4)
        .whenAwaitThenAwaitingOn(
          asff(ac(0, 1), ac(2, 3)),
          asff(ac(0, 1), ac(2, 3))
        )
        .givenNotifyFailure([1])
        .whenAwaitThenAwaitingOn(
          asff(ac(0, 1), ac(2, 3)),
          asff(ac(0), ac(2, 3))
        )
        .expectCompleted([1]);
    });

    // all_succeeded_or_first_failed!(unknown!(0, 1), all_completed!(2, 1)) with replay [2, 1]
    it("all succeeded or first failed unknown shared handle batch", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          asff(unk(0, 1), ac(2, 1)),
          asff(unk(0, 1), ac(2, 1))
        )
        .givenNotify([2, 1])
        .whenAwaitThenCompleted(asff(unk(0, 1), ac(2, 1)))
        .expectCompleted([2, 1]);
    });

    // all_succeeded_or_first_failed!(unknown!(0, 1), all_completed!(2, 1)) with replay [2] then [0]
    it("all succeeded or first failed unknown shared handle progressive", () => {
      AwaitTest.givenNFutures(3)
        .whenAwaitThenAwaitingOn(
          asff(unk(0, 1), ac(2, 1)),
          asff(unk(0, 1), ac(2, 1))
        )
        .givenNotify([2])
        .whenAwaitThenAwaitingOn(
          asff(unk(0, 1), ac(2, 1)),
          asff(unk(0, 1), ac(1))
        )
        .expectCompleted([2])
        .givenNotify([0])
        .whenAwaitThenCompleted(asff(unk(0, 1), ac(1)));
    });

    // all_succeeded_or_first_failed!(unknown!(0, 1), all_completed!(2, 3)) with replay [2, 3, 1]
    it("all succeeded or first failed unknown disjoint handles batch", () => {
      AwaitTest.givenNFutures(4)
        .whenAwaitThenAwaitingOn(
          asff(unk(0, 1), ac(2, 3)),
          asff(unk(0, 1), ac(2, 3))
        )
        .givenNotify([2, 3, 1])
        .whenAwaitThenCompleted(asff(unk(0, 1), ac(2, 3)))
        .expectCompleted([2, 3, 1]);
    });

    // all_succeeded_or_first_failed!(unknown!(0, 1), all_completed!(2, 3)) with replay [2, 3] then [1]
    it("all succeeded or first failed unknown disjoint handles progressive", () => {
      AwaitTest.givenNFutures(4)
        .whenAwaitThenAwaitingOn(
          asff(unk(0, 1), ac(2, 3)),
          asff(unk(0, 1), ac(2, 3))
        )
        .givenNotify([2, 3])
        .whenAwaitThenAwaitingOn(asff(unk(0, 1), ac(2, 3)), asff(unk(0, 1)))
        .expectCompleted([2, 3])
        .givenNotify([1])
        .whenAwaitThenCompleted(asff(unk(0, 1)))
        .expectCompleted([1]);
    });
  });

  /**
   * Multiple do_progress calls with progressively shrinking future.
   * all_completed(h1, h2, h3): first call nothing ready, second call h1 arrives,
   * third call h2 arrives. Each AwaitingOn should reflect the current state.
   */
  it("awaiting on shrinks across calls", () => {
    const output = VMTestCase.new()
      .input(
        msg(MessageType.Start, StartMessageDesc, {
          id: b("123"),
          debug_id: "123",
          known_entries: 1,
        })
      )
      .input(inputEntryMessage("my-data"))
      .runWithoutClosingInput((vm) => {
        vm.sysInput();

        const h1 = vm.sysAwakeable().handle; // signal 17
        const h2 = vm.sysAwakeable().handle; // signal 18
        const h3 = vm.sysAwakeable().handle; // signal 19

        const fut = () => ac(h1, h2, h3);

        // First call: nothing ready → WaitingExternalProgress, AwaitingOn has all 3
        expect(vm.doAwait(fut())).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        // h1 arrives
        vm.notifyInput(
          notification(MessageType.SignalNotification, {
            signal_id: 17,
            value: { content: b("v1") },
          }).bytes
        );

        // Second call: h1 resolves, h2+h3 still pending → WaitingExternalProgress
        expect(vm.doAwait(fut())).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        // h2 arrives
        vm.notifyInput(
          notification(MessageType.SignalNotification, {
            signal_id: 18,
            value: { content: b("v2") },
          }).bytes
        );

        // Third call: h1+h2 resolved, h3 still pending → WaitingExternalProgress
        expect(vm.doAwait(fut())).toEqual({
          type: "waitingExternalProgress",
          waitingInput: true,
          waitingRunProposal: false,
        });

        vm.notifyInputClosed();
        expectSuspended(() => vm.doAwait(fut()));
      });

    // First AwaitingOn: all 3 handles
    // Cancel wraps: FirstCompleted([AllCompleted([17, 18, 19]), Single(cancel)])
    let awaitingOn = output.nextDecoded(AwaitingOnMessageDef)!;
    expect(awaitingOn.executing_side_effects).toBe(false);
    expect(awaitingOn.awaiting_on!.waiting_signals).toEqual([1]);
    expect(awaitingOn.awaiting_on!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    expect(awaitingOn.awaiting_on!.nested_futures).toHaveLength(1);
    expect(
      [...awaitingOn.awaiting_on!.nested_futures[0]!.waiting_signals].sort()
    ).toEqual([17, 18, 19]);
    expect(awaitingOn.awaiting_on!.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );

    // Second AwaitingOn: h1 resolved, only h2+h3 remain
    awaitingOn = output.nextDecoded(AwaitingOnMessageDef)!;
    expect(awaitingOn.awaiting_on!.waiting_signals).toEqual([1]);
    expect(
      [...awaitingOn.awaiting_on!.nested_futures[0]!.waiting_signals].sort()
    ).toEqual([18, 19]);
    expect(awaitingOn.awaiting_on!.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );

    // Third AwaitingOn: h1+h2 resolved, only h3 remains
    // AllCompleted([h3]) stays as-is (no collapse during resolution, only normalization)
    awaitingOn = output.nextDecoded(AwaitingOnMessageDef)!;
    expect(awaitingOn.awaiting_on!.waiting_signals).toEqual([1]);
    expect(awaitingOn.awaiting_on!.waiting_completions).toEqual([]);
    expect(awaitingOn.awaiting_on!.nested_futures[0]!.waiting_signals).toEqual([
      19,
    ]);
    expect(awaitingOn.awaiting_on!.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );

    // Suspension with only h3, same structure
    const suspension = output.nextDecoded(SuspensionMessageDef)!;
    expect(suspension.awaiting_on!.waiting_signals).toEqual([1]);
    expect(suspension.awaiting_on!.waiting_completions).toEqual([]);
    expect(suspension.awaiting_on!.nested_futures[0]!.waiting_signals).toEqual([
      19,
    ]);
    expect(suspension.awaiting_on!.nested_futures[0]!.combinator_type).toBe(
      CombinatorType.AllCompleted
    );
    expect(suspension.awaiting_on!.combinator_type).toBe(
      CombinatorType.FirstCompleted
    );
    output.expectEnd();
  });

  describe("reverse await order", () => {
    function handler(vm: CoreVM) {
      vm.sysInput();

      const h1 = vm.sysCall(greeterTarget(), b("Francesco"), undefined);
      const h2 = vm.sysCall(greeterTarget(), b("Till"), undefined);

      if (isSuspendedWhen(() => vm.doAwait(s(h2.callNotificationHandle)))) {
        expectClosed(() => vm.takeNotification(h2.callNotificationHandle));
        return;
      }
      const h2Value = expectSuccess(
        vm.takeNotification(h2.callNotificationHandle)
      );

      vm.sysStateSet("A2", h2Value);

      if (isSuspendedWhen(() => vm.doAwait(s(h1.callNotificationHandle)))) {
        expectClosed(() => vm.takeNotification(h1.callNotificationHandle));
        return;
      }
      const h1Value = expectSuccess(
        vm.takeNotification(h1.callNotificationHandle)
      );

      const out = new Uint8Array(h1Value.length + 1 + h2Value.length);
      out.set(h1Value, 0);
      out.set(b("-"), h1Value.length);
      out.set(h2Value, h1Value.length + 1);
      vm.sysWriteOutput({ type: "success", value: out });
      vm.sysEnd();
    }

    const start = () =>
      msg(MessageType.Start, StartMessageDesc, {
        id: b("abc"),
        debug_id: "abc",
        known_entries: 1,
        partial_state: true,
      });

    const expectCalls = (output: ReturnType<VMTestCase["run"]>) => {
      expect(output.nextDecoded(CallCommand)).toEqual(
        create(CallCommand.desc, {
          service_name: "Greeter",
          handler_name: "greeter",
          parameter: b("Francesco"),
          invocation_id_notification_idx: 1,
          result_completion_id: 2,
        })
      );
      expect(output.nextDecoded(CallCommand)).toEqual(
        create(CallCommand.desc, {
          service_name: "Greeter",
          handler_name: "greeter",
          parameter: b("Till"),
          invocation_id_notification_idx: 3,
          result_completion_id: 4,
        })
      );
    };

    it("none completed", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
        .run(handler);

      expectCalls(output);
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        4
      );
      output.expectEnd();
    });

    it("a1 and a2 completed later", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
        .input(
          notification(MessageType.CallInvocationIdCompletionNotification, {
            completion_id: 1,
            invocation_id: "a1",
          })
        )
        .input(
          notification(MessageType.CallInvocationIdCompletionNotification, {
            completion_id: 3,
            invocation_id: "a2",
          })
        )
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 2,
            value: { content: b("FRANCESCO") },
          })
        )
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 4,
            value: { content: b("TILL") },
          })
        )
        .run(handler);

      expectCalls(output);
      expect(output.nextDecoded(SetStateCommand)).toEqual(
        create(SetStateCommand.desc, {
          key: b("A2"),
          value: { content: b("TILL") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "FRANCESCO-TILL"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("a2 and a1 completed later", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 4,
            value: { content: b("TILL") },
          })
        )
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 2,
            value: { content: b("FRANCESCO") },
          })
        )
        .run(handler);

      expectCalls(output);
      expect(output.nextDecoded(SetStateCommand)).toEqual(
        create(SetStateCommand.desc, {
          key: b("A2"),
          value: { content: b("TILL") },
        })
      );
      expectOutputWithSuccess(
        output.nextDecoded(OutputCommandMessageDef),
        "FRANCESCO-TILL"
      );
      expect(output.nextDecoded(EndMessageDef)).toEqual({});
      output.expectEnd();
    });

    it("only a2 completed", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 4,
            value: { content: b("TILL") },
          })
        )
        .run(handler);

      expectCalls(output);
      expect(output.nextDecoded(SetStateCommand)).toEqual(
        create(SetStateCommand.desc, {
          key: b("A2"),
          value: { content: b("TILL") },
        })
      );
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        2
      );
      output.expectEnd();
    });

    it("only a1 completed", () => {
      const output = VMTestCase.new()
        .input(start())
        .input(msg(MessageType.InputCommand, InputCommandMessageDesc))
        .input(
          notification(MessageType.CallCompletionNotification, {
            completion_id: 2,
            value: { content: b("FRANCESCO") },
          })
        )
        .run(handler);

      expectCalls(output);
      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        4
      );
      output.expectEnd();
    });
  });

  describe("combinators", () => {
    it("replay with combinator and entry afterwards", () => {
      const output = VMTestCase.new()
        .input(startMessage(5))
        .input(inputEntryMessage("my-data"))
        // Two sleep are created
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 1,
          })
        )
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 2,
          })
        )
        // Only one of them completes
        .input(
          notification(MessageType.SleepCompletionNotification, {
            completion_id: 2,
            void: VOID,
          })
        )
        // Another sleep here
        .input(
          msg(MessageType.SleepCommand, SleepCommand.desc, {
            wake_up_time: 0n,
            result_completion_id: 3,
          })
        )
        .run((vm) => {
          vm.sysInput();

          // Simulating the user code should be:
          //
          // val a = sleep()
          // val b = sleep()
          // await any(a, b)
          // val c = sleep()
          // await c

          const aHandle = vm.sysSleep("", 0n);
          const bHandle = vm.sysSleep("", 0n);

          // Transition should work fine here!
          expect(vm.doAwait(fc(aHandle, bHandle))).toEqual({
            type: "anyCompleted",
          });
          expect(vm.isCompleted(aHandle)).toBe(false);
          expect(vm.isCompleted(bHandle)).toBe(true);

          // Code moves on to c = sleep() and suspends
          const cHandle = vm.sysSleep("", 0n);
          expectSuspended(() => vm.doAwait(s(cHandle)));
        });

      expectSuspendedWaitingCompletion(
        output.nextDecoded(SuspensionMessageDef),
        3
      );
      output.expectEnd();
    });
  });
});
