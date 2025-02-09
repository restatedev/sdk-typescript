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

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as vm from "./endpoint/handlers/vm/sdk_shared_core_wasm_bindings.js";
import type {
  ReadableStreamDefaultReader,
  WritableStreamDefaultWriter,
} from "node:stream/web";
import type { ReadableStreamReadResult } from "stream/web";
import { pendingPromise } from "./promises.js";

/**
 * Adapter between input stream and vm. It moves forward when [awaitNextProgress] is invoked.
 */
export class InputPump {
  private currentRead?: Promise<void>;

  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly inputReader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly errorCallback: (e: any) => void
  ) {}

  // This function triggers a read on the input reader,
  // and will notify the caller that a read was executed
  // and the result was piped in the state machine.
  awaitNextProgress(): Promise<void> {
    if (this.currentRead === undefined) {
      // Register a new read
      this.currentRead = this.readNext().finally(() => {
        this.currentRead = undefined;
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    return new Promise<void>((resolve) => this.currentRead?.finally(resolve));
  }

  private async readNext(): Promise<void> {
    // Take input, and notify it to the vm
    let nextValue: ReadableStreamReadResult<Uint8Array>;
    try {
      nextValue = await this.inputReader.read();
    } catch (e) {
      this.errorCallback(e);
      return pendingPromise<void>();
    }
    if (nextValue.value !== undefined) {
      this.coreVm.notify_input(nextValue.value);
    }
    if (nextValue.done) {
      this.coreVm.notify_input_closed();
    }
  }
}

/**
 * Adapter between output stream and vm. It moves forward when [awaitNextProgress] is invoked.
 */
export class OutputPump {
  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly outputWriter: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  async awaitNextProgress() {
    const nextOutput = this.coreVm.take_output() as
      | Uint8Array
      | null
      | undefined;
    if (nextOutput instanceof Uint8Array) {
      await this.outputWriter.write(nextOutput);
    }
  }
}
