import { RestateContext } from "./restate_context";
import { NewStateMachine } from "./new_state_machine";
import {
  Failure,
  GetStateEntryMessage,
  OutputStreamEntryMessage,
  SetStateEntryMessage
} from "./generated/proto/protocol";
import {
  GET_STATE_ENTRY_MESSAGE_TYPE,
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE
} from "./types/protocol";

export class RestateContextImpl<I, O> implements RestateContext {
  instanceKey: Buffer;
  invocationId: Buffer;
  serviceName: string;

  // This flag is set to true when we are executing code that is inside a side effect.
  // We use this flag to prevent the user from doing operations on the context from within a side effect.
  // e.g. ctx.sideEffect(() => {await ctx.get("my-state")})
  private inSideEffectFlag = false;

  // This flag is set to true when a unidirectional call follows.
  // Both types of requests (unidirectional or request-response) call the same request() method.
  // So to be able to know if a request is a unidirectional request or not, the user first sets this flag:
  // e.g.: ctx.oneWayCall(() => client.greet(request))
  private oneWayCallFlag = false;
  private oneWayCallDelay = 0;

  constructor(
    instanceKey: Buffer,
    invocationId: Buffer,
    serviceName: string,
    private readonly stateMachine: NewStateMachine<I, O>
  ) {
    this.instanceKey = instanceKey
    this.invocationId = invocationId
    this.serviceName = serviceName
  }

  awakeable<T>(): { id: string; promise: Promise<T> } {

    return { id: "", promise: new Promise<T>(() =>{return;}) };
  }

  clear(name: string): void {
    return;
  }

  completeAwakeable<T>(id: string, payload: T): void {
    return;
  }

  async get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    if (!this.isValidState("get state")) {
      return Promise.reject();
    }

    // Create the message and let the state machine process it
    const msg = GetStateEntryMessage.create({ key: Buffer.from(name) });
    const promise = this.stateMachine.handleUserCodeMessage(GET_STATE_ENTRY_MESSAGE_TYPE, msg);

    // Wait for the result, do post-processing and then deliver it back to the user code.
    return promise.then((result) => {
      if (result instanceof Buffer) {
        const resultString = result.toString();
        if (resultString === "0") {
          return resultString as T;
        }
        return JSON.parse(resultString) as T;
      } else {
        return null;
      }
    })
  }

  oneWayCall<T>(call: () => Promise<T>, delayMillis?: number): void {
  }

  request(service: string, method: string, data: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  set<T>(name: string, value: T): void {
    if (!this.isValidState("set state")) {
      return;
    }

    const bytes = Buffer.from(JSON.stringify(value));
    const msg = SetStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
      value: bytes,
    });
    this.stateMachine.handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>(() =>{return;});
  }

  sleep(millis: number): Promise<void> {
    return Promise.resolve(undefined);
  }

  isValidState(callType: string): boolean {
    if (this.inSideEffectFlag) {
      this.stateMachine.handleUserCodeMessage(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({failure:
            Failure.create({
              code: 13,
              message: `You cannot do ${callType} calls from within a side effect.`,
            })}));
      return false;
    } else if (this.oneWayCallFlag) {
      this.stateMachine.handleUserCodeMessage(OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({failure:
        Failure.create({
          code: 13,
          message: `Cannot do a ${callType} from within ctx.oneWayCall(...).
          Context method oneWayCall() can only be used to invoke other services in the background.
          e.g. ctx.oneWayCall(() => client.greet(my_request))`,
        })}));
      return false;
    } else {
      return true;
    }
  }
}