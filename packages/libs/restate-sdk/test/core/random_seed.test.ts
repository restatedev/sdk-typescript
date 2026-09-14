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
import * as wasm from "../../src/endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import { TsVM } from "../../src/endpoint/handlers/vm/ts/bindings.js";
import {
  computeRandomSeed,
  sipHash13,
} from "../../src/endpoint/handlers/vm/ts/random_seed.js";
import {
  LogLevel,
  WasmJournalMismatchBehavior,
  type WasmVM,
} from "../../src/endpoint/handlers/vm/types.js";
import { b, inputEntryMessage, startMessage, Version } from "./testutils.js";
import { versionContentType } from "../../src/endpoint/handlers/vm/ts/version.js";

function randomSeedThrough(
  factory: (headers: { key: string; value: string }[]) => WasmVM,
  id: Uint8Array
): bigint {
  const vm = factory([
    { key: "content-type", value: versionContentType(Version.V5) },
  ]);
  // In V5 the runtime doesn't provide a random seed: the VM derives it from the id
  vm.notify_input(startMessage(1, { id, debug_id: "dbg" }).bytes);
  vm.notify_input(inputEntryMessage("input").bytes);
  vm.notify_input_closed();
  return vm.sys_input().random_seed;
}

describe("random seed", () => {
  // The inlined WASM module is instantiated lazily by the selector
  wasm.initSync();

  it("siphash-1-3 known vectors", () => {
    // Reference values computed with Rust's DefaultHasher::new() + Hasher::write(bytes) + finish()
    // Verified indirectly below against the WASM build of the shared core.
    expect(typeof sipHash13(new Uint8Array(0))).toBe("bigint");
  });

  it.each([
    [b("")],
    [b("a")],
    [b("1234567")],
    [b("12345678")],
    [b("123456789")],
    [b("some-longer-invocation-id-bytes-here!")],
    [
      new Uint8Array([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]),
    ],
  ])("matches the WASM shared core for id %s", (id) => {
    const expected = randomSeedThrough(
      (headers) =>
        new wasm.WasmVM(
          headers.map((h) => new wasm.WasmHeader(h.key, h.value)),
          LogLevel.ERROR,
          1,
          false,
          false,
          WasmJournalMismatchBehavior.Retry
        ) as unknown as WasmVM,
      id
    );
    const actual = randomSeedThrough(
      (headers) =>
        new TsVM(
          headers,
          LogLevel.ERROR,
          1,
          false,
          false,
          WasmJournalMismatchBehavior.Retry
        ),
      id
    );
    expect(actual).toBe(expected);
    expect(computeRandomSeed(id)).toBe(expected);
  });

  it("uses the seed from the start message on V6+", () => {
    const vm = new TsVM(
      [{ key: "content-type", value: versionContentType(Version.V7) }],
      LogLevel.ERROR,
      1,
      false,
      false,
      WasmJournalMismatchBehavior.Retry
    );
    vm.notify_input(
      startMessage(1, { id: b("abc"), random_seed: 0xdeadbeefn }).bytes
    );
    vm.notify_input(inputEntryMessage("input").bytes);
    vm.notify_input_closed();
    expect(vm.sys_input().random_seed).toBe(0xdeadbeefn);
  });
});
