import { RestateTestEnvironment } from "../src/restate_test_environment";
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";

const exampleService = restate.service({
  name: "ExampleService",
  handlers: {
    // eslint-disable-next-line @typescript-eslint/require-await
    greet: async (ctx: restate.Context, name: string) => {
      ctx.console.info("Hello there");
      return `Hello ${name}!`;
    },
  },
});

describe("ExampleService", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let restateIngress: clients.Ingress;

  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start(
      (restateServer) => restateServer.bind(exampleService)
    );
    restateIngress = clients.connect({ url: restateTestEnvironment.baseUrl() });
  }, 20_000);

  afterAll(async () => {
    if (restateTestEnvironment !== undefined) {
      await restateTestEnvironment.stop();
    }
  });

  it("works", async () => {
    const greet = await restateIngress
      .serviceClient(exampleService)
      .greet("Sarah");

    // Assert the result
    expect(greet).toBe("Hello Sarah!");
  });
});

const exampleObject = restate.object({
  name: "ExampleObject",
  handlers: {
    greet: async (ctx: restate.ObjectContext) => {
      const count = (await ctx.get<number>("count")) ?? 0;
      ctx.set("count", count + 1);
      return `Hello ${ctx.key}! Counter: ${count}`;
    },
  },
});

describe("ExampleObject", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let restateIngress: clients.Ingress;

  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start(
      (restateServer) => restateServer.bind(exampleObject)
    );
    restateIngress = clients.connect({ url: restateTestEnvironment.baseUrl() });
  }, 20_000);

  afterAll(async () => {
    if (restateTestEnvironment !== undefined) {
      await restateTestEnvironment.stop();
    }
  });

  it("works", async () => {
    const state = restateTestEnvironment.stateOf(exampleObject, "Sarah");
    expect(await state.getAll()).toStrictEqual({});
    expect(await state.get("count")).toBeNull();

    // Setting state is an eventually consistent operation, so retrying might be needed
    await state.set("count", 123);
    const greet = await restateIngress
      .objectClient(exampleObject, "Sarah")
      .greet();

    // Assert the result
    expect(greet).toBe("Hello Sarah! Counter: 123");
    expect(await state.get("count")).toStrictEqual(124);
  });
});
