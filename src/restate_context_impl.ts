import { RestateContext } from "./restate_context";
import { NewStateMachine } from "./new_state_machine";
import {
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  Failure,
  GetStateEntryMessage, InvokeEntryMessage,
  OutputStreamEntryMessage,
  SetStateEntryMessage
} from "./generated/proto/protocol";
import {
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE, INVOKE_ENTRY_MESSAGE_TYPE,
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

  clear(name: string): void {
    if (!this.isValidState("clear state")) {
      return;
    }

    const msg = ClearStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
    });
    this.stateMachine.handleUserCodeMessage(CLEAR_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  request(service: string, method: string, data: Uint8Array): Promise<Uint8Array> {
    if (this.oneWayCallFlag) {
      return this.invokeOneWay(service, method, data);
    } else {
      return this.invoke(service, method, data);
    }
  }

  private async invoke(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (!this.isValidState("invoke")) {
      return Promise.reject();
    }

    const msg = InvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
    });
    const promise = this.stateMachine.handleUserCodeMessage(INVOKE_ENTRY_MESSAGE_TYPE, msg);
    return (await promise) as Uint8Array;
  }

  private async invokeOneWay(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {

    const invokeTime = (this.oneWayCallDelay > 0) ?  Date.now() + this.oneWayCallDelay : undefined;
    const msg = BackgroundInvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
      invokeTime: invokeTime
    })

    this.stateMachine.handleUserCodeMessage(BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE, msg)
    return new Uint8Array();
  }

  async oneWayCall<T>(call: () => Promise<T>, delayMillis?: number): Promise<void> {
    if (!this.isValidState("oneWayCall")) {
      return Promise.reject();
    }

    this.oneWayCallFlag = true;
    this.oneWayCallDelay = delayMillis || 0;
    await call().finally(() => {
      this.oneWayCallDelay = 0;
      this.oneWayCallFlag = false;
    });
  }

  sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>(() =>{return;});
  }

  sleep(millis: number): Promise<void> {
    return Promise.resolve(undefined);
  }

  awakeable<T>(): { id: string; promise: Promise<T> } {

    return { id: "", promise: new Promise<T>(() =>{return;}) };
  }

  completeAwakeable<T>(id: string, payload: T): void {
    return;
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