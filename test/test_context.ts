"use strict";

import { RestateContext } from "../src/restate_context";

/* eslint-disable @typescript-eslint/no-unused-vars */

export class TestingContext implements RestateContext {
  /**
   * Creates a TestingContext with sample default values for the
   * 'instanceKey', 'servicName', and 'invocationId' properties.
   */
  public static create(): TestingContext {
    const instanceKey = Buffer.from("test-instance-key");
    const invocationId = Buffer.from("test-invocation-id");
    const serviceName = "test-service";

    return new TestingContext(instanceKey, serviceName, invocationId);
  }

  constructor(
    readonly instanceKey: Buffer,
    readonly serviceName: string,
    readonly invocationId: Buffer
  ) {}

  // ------------------------------------------------------
  //  RestateContext methods
  // ------------------------------------------------------

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  get<T>(name: string): Promise<T | null> {
    throw new Error("Method not implemented.");
  }
  set<T>(name: string, value: T): void {
    throw new Error("Method not implemented.");
  }
  clear(name: string): void {
    throw new Error("Method not implemented.");
  }
  oneWayCall<T>(call: () => Promise<T>, delayMillis?: number): Promise<void> {
    throw new Error("Method not implemented.");
  }
  sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    // we simply call the side effect here
    return fn();
  }
  awakeable<T>(): { id: string; promise: Promise<T> } {
    throw new Error("Method not implemented.");
  }
  completeAwakeable<T>(id: string, payload: T): void {
    throw new Error("Method not implemented.");
  }
  sleep(millis: number): Promise<void> {
    return Promise.resolve();
  }
}
