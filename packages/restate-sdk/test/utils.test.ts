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

import { RandImpl } from "../src/utils/rand.js";
import { describe, expect, it } from "vitest";

describe("rand", () => {
  it("correctly hashes invocation ids", () => {
    const rand = new RandImpl(
      "f311f1fdcb9863f0018bd3400ecd7d69b547204e776218b2"
    );

    const actual: bigint[] = Array.from(Array(10)).map(() => rand.u64());

    // These values were produced with the reference implementation:
    // http://xoshiro.di.unimi.it/xoshiro256plusplus.c
    const expected = [
      6221017497105640564n,
      6390535423083911304n,
      6450107027926477268n,
      6892944322147831477n,
      11902315545316364308n,
      11803614765068293030n,
      3688900223715244673n,
      16180860676245615018n,
      14289837324736329951n,
      5956009879523072622n,
    ];

    expect(actual).toStrictEqual(expected);
  });

  it("produces expected u64 output", () => {
    const rand = new RandImpl([1n, 2n, 3n, 4n]);

    const actual: bigint[] = Array.from(Array(10)).map(() => rand.u64());

    // These values were produced with the reference implementation:
    // http://xoshiro.di.unimi.it/xoshiro256plusplus.c
    const expected = [
      41943041n,
      58720359n,
      3588806011781223n,
      3591011842654386n,
      9228616714210784205n,
      9973669472204895162n,
      14011001112246962877n,
      12406186145184390807n,
      15849039046786891736n,
      10450023813501588000n,
    ];

    expect(actual).toStrictEqual(expected);
  });

  it("produces expected random output", () => {
    const rand = new RandImpl([1n, 2n, 3n, 4n]);

    const actual = Array.from(Array(10)).map(() => rand.random());

    const expected = [
      4.656612984099695e-9, 6.519269457605503e-9, 0.39843750651926946,
      0.3986824029416509, 0.5822761557370711, 0.2997488042907357,
      0.5336032865255543, 0.36335061693258097, 0.5968067925950846,
      0.18570456306457928,
    ];

    expect(actual).toStrictEqual(expected);
  });

  it("produces expected uuidv4 output", () => {
    const rand = new RandImpl([1n, 2n, 3n, 4n]);

    const actual = Array.from(Array(10)).map(() => rand.uuidv4());

    const expected = [
      "01008002-0000-4000-a700-800300000000",
      "67008003-00c0-4c00-b200-449901c20c00",
      "cd33c49a-01a2-4280-ba33-eecd8a97698a",
      "bd4a1533-4713-41c2-979e-167991a02bac",
      "d83f078f-0a19-43db-a092-22b24af10591",
      "677c91f7-146e-4769-a4fd-df3793e717e8",
      "f15179b2-f220-4427-8d90-7b5437d9828d",
      "9e97720f-42b8-4d09-a449-914cf221df26",
      "09d0a109-6f11-4ef9-93fa-f013d0ad3808",
      "41eb0e0c-41c9-4828-85d0-59fb901b4df4",
    ];

    expect(actual).toStrictEqual(expected);
  });
});
