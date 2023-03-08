import {
  RestateDuplexStream,
} from "../src/protocol_stream";
import * as restate from "../src/public_api";
import { TestConnection } from "../src/bidirectional_server";
import { ServerHttp2Stream } from "http2";
import stream from "stream";
import { DurableExecutionStateMachine  } from "../src/durable_execution";


export class TestDriver {
    static async setupAndRun(
        descriptor: any,
        service: string, 
        instance: object,
        methodName: string,
        entries: Array<any>
    ): Promise<Array<any>> {
        const http2stream = this.mockHttp2DuplexStream();
        const restateStream = RestateDuplexStream.from(http2stream);
        const connection = new TestConnection(http2stream as ServerHttp2Stream, restateStream);

        const restateServer: restate.RestateServer = restate.createServer()
          .bindService({
            descriptor: descriptor,
            service: service,
            instance: instance,
          });

        const desm = new DurableExecutionStateMachine(connection, restateServer.methods[methodName]);
    
        // Pipe messages through the state machine
        entries.forEach(el => desm.onIncomingMessage(el.message_type, el.message));

        // Tell the connection that all messages have finished
        connection.setAsFinished();
    
        return await connection.getResult();
    }


    static mockHttp2DuplexStream() {
        return new stream.Duplex({
          write(chunk, _encoding, next) {
            this.push(chunk);
            next();
          },
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          read(_encoding) {
            // don't care.
          },
        });
      }
      
}