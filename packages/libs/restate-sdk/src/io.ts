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
import { InputReader, OutputWriter } from "./endpoint/handlers/types.js";
import { ExternalProgressChannel } from "./utils/external_progress_channel.js";

/**
 * Adapter between input stream and vm.
 *
 * It starts a detached promise that fills the vm with input.
 * Each read (value or input-closed) emits a signal on the shared {@link ExternalProgressChannel}.
 */
export class InputPump {
  private stopped = false;
  private readonly runDone: Promise<InputReader>;

  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly inputReader: InputReader,
    private readonly channel: ExternalProgressChannel,
    private readonly errorCallback: (e: any) => void
  ) {
    this.runDone = this.run()
      .catch(() => {})
      .then(() => this.inputReader);
  }

  /**
   * Stop the pump.
   * Once finished, returns back the ownership of the input reader for further usage.
   */
  stop(): Promise<InputReader> {
    this.stopped = true;
    return this.runDone;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let nextValue;
      try {
        nextValue = await this.inputReader.next();
      } catch (e) {
        if (this.stopped) return;
        this.errorCallback(e);
        return;
      }
      if (this.stopped) return;
      if (nextValue.done) {
        this.coreVm.notify_input_closed();
        this.channel.signal();
        return;
      }
      if (nextValue.value !== undefined) {
        this.coreVm.notify_input(nextValue.value);
        this.channel.signal();
      }
    }
  }
}

/**
 * Adapter between output stream and vm. It moves forward when [awaitNextProgress] is invoked.
 */
export class OutputPump {
  constructor(
    private readonly coreVm: vm.WasmVM,
    private readonly outputWriter: OutputWriter
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
