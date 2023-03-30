import * as restate from "./public_api";
import {
  GreetRequest,
  GreetResponse,
  Greeter,
  protoMetadata,
} from "./generated/proto/example";
import { Sequelize } from "sequelize";

export class GreeterService implements Greeter {
  async greet(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    const sequelize = await this.connect();

    const result = await ctx.sequelizeTx(sequelize,
      async (t) => {
        return await sequelize.query("SELECT * FROM product WHERE id = '12'",
          { transaction: t });
      }
    )

    console.log(result);

    return GreetResponse.create({ greeting: `Hello ${request.name}` });
  }

  async connect(): Promise<Sequelize> {
    const sequelize = new Sequelize('postgres://restatedb:restatedb@localhost:5432/productsdb');
    try {
      await sequelize.authenticate();
      console.log('Connection has been established successfully.');
    } catch (error) {
      console.error('Unable to connect to the database:', error);
    }
    return sequelize;
  }

  async multiWord(request: GreetRequest): Promise<GreetResponse> {
    const ctx = restate.useContext(this);

    // state
    console.log("Getting the state");
    let seen = (await ctx.get<number>("seen")) || 0;
    seen += 1;

    await ctx.set("seen", seen);

    // return the final response

    return GreetResponse.create({
      greeting: `YAGM (yet another greeting method) ${request.name}!`,
    });
  }
}

restate
  .createServer()
  .bindService({
    descriptor: protoMetadata,
    service: "Greeter",
    instance: new GreeterService(),
  })
  .listen(8000);
