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

import { describe, expect } from "@jest/globals";
import {
  jsonDeserialize,
  jsonSerialize,
  printMessageAsJson,
} from "../src/utils/utils";
import {RandImpl} from "../src/utils/rand";

describe("JSON de-/serialization", () => {
  it("should be able to handle bigint", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    const json = jsonSerialize(myType);
    const obj = jsonDeserialize(json);

    expect(obj).toStrictEqual(myType);
  });
});

describe("JSON printing", () => {
  it("should be able to handle bigInt", () => {
    const myType = {
      a: "Hello!",
      b: 42n,
    };

    printMessageAsJson(myType);
  });
});

describe("rand", () => {
  it("expected u64 output", () => {
    const rand = new RandImpl(1477776061723855037n)

    const actual: bigint[] = Array.from(Array(50)).map(() => rand.u64())

    // These values were produced with the reference implementation:
    // http://xoshiro.di.unimi.it/splitmix64.c
    const expected = [
      1985237415132408290n, 2979275885539914483n, 13511426838097143398n,
      8488337342461049707n, 15141737807933549159n, 17093170987380407015n,
      16389528042912955399n, 13177319091862933652n, 10841969400225389492n,
      17094824097954834098n, 3336622647361835228n, 9678412372263018368n,
      11111587619974030187n, 7882215801036322410n, 5709234165213761869n,
      7799681907651786826n, 4616320717312661886n, 4251077652075509767n,
      7836757050122171900n, 5054003328188417616n, 12919285918354108358n,
      16477564761813870717n, 5124667218451240549n, 18099554314556827626n,
      7603784838804469118n, 6358551455431362471n, 3037176434532249502n,
      3217550417701719149n, 9958699920490216947n, 5965803675992506258n,
      12000828378049868312n, 12720568162811471118n, 245696019213873792n,
      8351371993958923852n, 14378754021282935786n, 5655432093647472106n,
      5508031680350692005n, 8515198786865082103n, 6287793597487164412n,
      14963046237722101617n, 3630795823534910476n, 8422285279403485710n,
      10554287778700714153n, 10871906555720704584n, 8659066966120258468n,
      9420238805069527062n, 10338115333623340156n, 13514802760105037173n,
      14635952304031724449n, 15419692541594102413n,
    ]

    expect(actual).toStrictEqual(expected)
  });

  it("expected random output", () => {
    const rand = new RandImpl(1477776061723855037n)

    const actual = Array.from(Array(50)).map(() => rand.random())

    const expected =  [
      0.40562876273298465, 0.7660684836915536, 0.06971711937258074,
      0.3947558385769815, 0.07059472050725624, 0.7231994044448954,
      0.6031395981643762, 0.9763058618887208, 0.7004060411626285,
      0.906731546642922, 0.43952875868538, 0.5196257503384771,
      0.6340415835012271, 0.10174673747469609, 0.8523223196903388,
      0.9386438627277667, 0.5145549414635722, 0.9644288803681328,
      0.054811543915718186, 0.10708614869526834, 0.32886882722913735,
      0.37717883178926537, 0.9523539466324108, 0.45419354745831453,
      0.18970023364060729, 0.9410229083698497, 0.194320746664278,
      0.21985566247384514, 0.6377947060954611, 0.3372601480277686,
      0.3595979885936371, 0.26676606670221914, 0.27773775899875375,
      0.18854749029009943, 0.36237798498734475, 0.8790924571478034,
      0.5143591890128688, 0.3769752437815147, 0.0853226020893767,
      0.2318451649900749, 0.09931210013144343, 0.06150371552695488,
      0.7613300433431692, 0.024097973430863284, 0.3495517557811252,
      0.8566018855560766, 0.7613674619014001, 0.4445197536228266,
      0.9171235251629818, 0.9297692318571805,
    ]

    expect(actual).toStrictEqual(expected)
  });

  it("expected uuidv4 output", () => {
    const rand = new RandImpl(1477776061723855037n)

    const actual = Array.from(Array(50)).map(() => rand.uuidv4())

    const expected =  [
      "e229c82b-e9fa-4c1b-b372-7e0da2835829", "66a67565-1f3b-42bb-abfb-12ffd6a1cc75", "672afbdb-4f42-42d2-a77a-d213732437ed",
      "073c216a-eb4c-43e3-9490-76cae53ddfb6", "b4db16ee-b969-4696-b2a6-62e0f1033ded", "dc90869d-9e10-4e2e-809f-7b2ec6a05086",
      "6b232e93-114a-449a-aab6-bd5f8241636d", "4d111775-3946-4b4f-8a38-a0da5e093e6c", "7e99b2ec-3b77-4040-87f8-8ff499dcfe3a",
      "fcf59123-04c1-416c-9006-50ee3f6d2346", "c6ef33eb-1786-4ab3-bde8-6857d911ace4", "6516e0fb-ae79-4e47-aa67-0ce8c0882efb",
      "7ef57039-0612-4669-a787-0713dc1c3e58", "9e6f7b24-e037-462a-ad4c-05be0e09a72c", "f3bd8771-d068-448a-92bf-40cbd5caca52",
      "18f216a4-d381-4ba6-8e65-85fd588988b0", "8072f84b-3ae3-4803-8c3e-11bf9408e673", "eaf349b7-9998-4bc7-aa85-338186217c4e",
      "a5a2e666-a175-404c-b72e-ee622e102c76", "fcab3277-f6ba-4257-b1c7-2b8d466ba7cf", "0c2cc591-902d-4332-8eaa-d8a3d6f7e174",
      "a9e0b3d2-d05c-4892-8822-f91c69c5e096", "a4dbea29-872f-4b78-96f8-845b4869bb82", "7c5ca34b-1f5d-488f-b58d-877d81398ebb",
      "a1f35e6f-1359-4dcb-8dea-7467abc0fdd5", "2c922ad0-97d9-4b81-8cb7-c6fdd022a2d2", "c37a7743-597b-4f66-b92c-552efbe4a53d",
      "98d33970-1851-4701-82bd-c466db2660cc", "437dfd8f-8fe9-4c12-b031-febcc0f627c8", "7078daa9-2c29-4dba-947d-c26393490f96",
      "2f6d71cc-e589-4782-ae12-cd4cdc05a93d", "db2afb9b-65cb-42e9-96a0-09738c04103f", "1bd2b462-d58f-44eb-9618-5e4fda702dd7",
      "cacde8a3-4faf-4977-a815-e2f75e74b1f6", "6ba4b284-3f67-4cc1-b6d1-1293c501e04e", "50708cc7-c36a-4e0f-bd7f-7fb0a83198e9",
      "84bfad92-28ed-487e-9e31-8a2d6907f1ea", "501fcdb7-acae-42e9-92e5-b925b21aef37", "44535164-06cc-49d6-87c4-07bb9900c1da",
      "06a090a6-b3d9-4a08-bc82-82304d67c582", "e71d1508-4620-45e4-bab5-7b0530e4706c", "31f3b847-9dc4-4305-b96b-dc7248a1ebfc",
      "db438e58-b8db-4fc8-9631-8b5e79f7e3c9", "8802e117-733d-413d-8081-ae9f1d58fb49", "54e9457d-a1c3-4105-a6ff-bed6d596a04f",
      "af8b8a6e-c5e5-41fe-9e0a-fdf327c4fbc8", "554222be-3e89-4789-bf77-5081c63dd859", "18390152-0f87-4d6e-b322-6662e4de6815",
      "0e1ff0e7-a682-4ed3-a1ff-43292479de48", "48394cfc-f05e-4726-a4f6-9cb888631043",
    ]

    expect(actual).toStrictEqual(expected)
  });

  it("clone should not mutate original state", () => {
    const rand1 = new RandImpl(1477776061723855037n)

    expect(rand1.random()).toStrictEqual(0.40562876273298465)
    expect(rand1.random()).toStrictEqual(0.7660684836915536)

    const rand2 = rand1.clone()

    expect(rand1.random()).toStrictEqual(0.06971711937258074)

    expect(rand2.random()).toStrictEqual(0.998171769797398)
    expect(rand2.random()).toStrictEqual(0.6733753646859768)
    expect(rand2.random()).toStrictEqual(0.9623893622218933)

    expect(rand1.random()).toStrictEqual(0.3947558385769815)
  });
});
