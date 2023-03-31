// import { protoMetadata, TestGreeter, TestRequest, TestResponse } from "../src/generated/proto/test";
// import * as restate from "../src/public_api";
// import { describe, expect } from "@jest/globals";
// import { TestDriver } from "../src/testdriver";
// import { greetRequest, inputMessage, invokeMessage, startMessage } from "./protoutils";
//
// class SequelizeTransactionGreeter implements TestGreeter {
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   async greet(request: TestRequest): Promise<TestResponse> {
//     const ctx = restate.useContext(this);
//
//     await ctx.inBackground(async () => ctx.sideEffect(async () => 13));
//
//     return TestResponse.create({ greeting: `Hello` });
//   }
// }
//
// describe("ReverseAwaitOrder: None completed", () => {
//   it("should call greet", async () => {
//     const result = await new TestDriver(
//       protoMetadata,
//       "TestGreeter",
//       new ReverseAwaitOrder(),
//       "/dev.restate.TestGreeter/Greet",
//       [startMessage(1), inputMessage(greetRequest("Till"))]
//     ).run();
//
//     expect(result).toStrictEqual([
//       invokeMessage(
//         "dev.restate.TestGreeter",
//         "Greet",
//         greetRequest("Francesco")
//       ),
//       invokeMessage("dev.restate.TestGreeter", "Greet", greetRequest("Till")),
//     ]);
//   });
// });
