/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import {
  RestateContainer,
  RestateTestEnvironment,
} from "@restatedev/restate-sdk-testcontainers";
import { counter } from "../src/object.js";
import * as clients from "@restatedev/restate-sdk-clients";
import * as core from "@restatedev/restate-sdk-core";
import { describe, it, beforeAll, afterAll, expect } from "vitest";

describe("ExampleObject", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let rs: clients.Ingress;

  const serviceKey = "foo";

  // Deploy Restate and the Service endpoint once for all the tests in this suite
  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start({
      services: [counter],
    });
    rs = clients.connect({ url: restateTestEnvironment.baseUrl() });
  }, 20_000);

  // Stop Restate and the Service endpoint
  afterAll(async () => {
    if (restateTestEnvironment !== undefined) {
      await restateTestEnvironment.stop();
    }
  });

  it("Can read state", async () => {
    const state = restateTestEnvironment.stateOf(counter, serviceKey);

    // State reading
    expect(await state.getAll()).toStrictEqual({});
    expect(await state.get("count")).toBeNull();
  });

  it("Can call methods", async () => {
    const client = rs.objectClient(counter, serviceKey);

    const count = await client.add(1);

    expect(count).toBe(1);
  });

  it("Can write state", async () => {
    const state = restateTestEnvironment.stateOf(counter, serviceKey);

    await state.setAll({
      count: 123,
    });
    expect(await state.getAll()).toStrictEqual({ count: 123 });

    await state.set("count", 321);
    expect(await state.get<number>("count")).toStrictEqual(321);
  });

  it("Can operate on state with non-JSON serde", async () => {
    const state = restateTestEnvironment.stateOf(counter, serviceKey);

    // State operations with non-JSON serde
    await state.setAll(
      {
        count: new Uint8Array([49, 50]), // 12
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      core.serde.binary as any
    );
    expect(
      await state.getAll<{ count: Uint8Array }>(core.serde.binary)
    ).toStrictEqual({
      count: new Uint8Array([49, 50]),
    });

    await state.set(
      "count",
      new Uint8Array([49, 52]), // 14
      core.serde.binary
    );
    expect(
      await state.get<Uint8Array>("count", core.serde.binary)
    ).toStrictEqual(new Uint8Array([49, 52]));
  });

  it("Can operate on typed state", async () => {
    // Typed state
    const state = restateTestEnvironment.stateOf<{
      count: number;
    }>(counter, serviceKey);

    await state.setAll({ count: 1 });
    // wont compile:
    // state.setAll({ count: "a" });
    // state.setAll({ foo: 1 });

    expect(await state.getAll()).toStrictEqual({ count: 1 });
    // wont compile:
    // (await state.getAll()) satisfies { count: string };
    // (await state.getAll()) satisfies { foo: number };

    await state.set("count", 2);
    // wont compile:
    // state.set("count", "a");
    // state.set("foo", 2);

    expect(await state.get("count")).toStrictEqual(2);
    // wont compile:
    // await state.get("foo");
    // (await state.get("count")) satisfies string;
  });
});

describe("Custom testcontainer config", () => {
  let restateTestEnvironment: RestateTestEnvironment;

  // Deploy Restate and the Service endpoint once for all the tests in this suite
  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start(
      { services: [counter] },
      () =>
        new RestateContainer()
          .withEnvironment({ RESTATE_LOG_FORMAT: "json" })
          .withLogConsumer((stream) => {
            // eslint-disable-next-line no-console
            stream.on("data", (line) => console.info(line));
            // eslint-disable-next-line no-console
            stream.on("err", (line) => console.error(line));
          })
    );
  }, 20_000);

  // Stop Restate and the Service endpoint
  afterAll(async () => {
    if (restateTestEnvironment !== undefined) {
      await restateTestEnvironment.stop();
    }
  });

  it("Works", () => {});
});
