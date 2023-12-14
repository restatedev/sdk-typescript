/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { RemoteContext } from "../generated/proto/services";
import { Message } from "../types/types";
import { BufferedConnection } from "./buffered_connection";
import { Connection } from "./connection";

export class FencedOffError extends Error {
  constructor() {
    super("FencedOff");
  }
}

export class InvocationAlreadyCompletedError extends Error {
  constructor() {
    super("Completed");
  }
}

export class EmbeddedConnection implements Connection {
  private buffered: BufferedConnection;

  constructor(
    private readonly operationId: string,
    private readonly streamId: string,
    private readonly remote: RemoteContext
  ) {
    this.buffered = new BufferedConnection((buffer) => this.sendBuffer(buffer));
  }

  send(msg: Message): Promise<void> {
    return this.buffered.send(msg);
  }

  end(): Promise<void> {
    return this.buffered.end();
  }

  private async sendBuffer(buffer: Buffer): Promise<void> {
    const res = await this.remote.send({
      operationId: this.operationId,
      streamId: this.streamId,
      messages: buffer,
    });

    if (res.invalidStream !== undefined) {
      throw new FencedOffError();
    }
    if (res.invocationCompleted !== undefined) {
      throw new InvocationAlreadyCompletedError();
    }
  }
}
