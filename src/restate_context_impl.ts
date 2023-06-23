import { RestateContext } from "./restate_context";
import { StateMachine } from "./state_machine";
import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  CompleteAwakeableEntryMessage,
  Failure,
  InvokeEntryMessage,
  SleepEntryMessage,
} from "./generated/proto/protocol";
import {
  AWAKEABLE_ENTRY_MESSAGE_TYPE,
  AwakeableIdentifier,
  BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
  CLEAR_STATE_ENTRY_MESSAGE_TYPE,
  COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
  GET_STATE_ENTRY_MESSAGE_TYPE,
  INVOKE_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "./types/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";
import { AsyncLocalStorage } from "async_hooks";
import { RestateError } from "./types/errors";
import { jsonSerialize, jsonDeserialize } from "./utils/utils";
import { Empty } from "./generated/google/protobuf/empty";

enum CallContexType {
  None,
  SideEffect,
  OneWayCall,
}

interface CallContext {
  type: CallContexType;
  delay?: number;
}

export class RestateContextImpl implements RestateContext {
  // here, we capture the context information for actions on the Restate context that
  // are executed within other actions, such as
  // ctx.oneWayCall( () => client.foo(bar) );
  // we also use this information to ensure we check that only allowed operations are
  // used. Within side-effects, no operations are allowed on the RestateContext.
  // For example, this is illegal: 'ctx.sideEffect(() => {await ctx.get("my-state")})'
  private callContext = new AsyncLocalStorage<CallContext>();

  constructor(
    public readonly instanceKey: Buffer,
    public readonly invocationId: Buffer,
    public readonly serviceName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly stateMachine: StateMachine<any, any>
  ) {}

  public async get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    this.checkState("get state");

    // Create the message and let the state machine process it
    const msg = this.stateMachine.localStateStore.get(name);
    const result = await this.stateMachine.handleUserCodeMessage(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );

    // If the GetState message did not have a value or empty,
    // then we went to the runtime to get the value.
    // When we get the response, we set it in the localStateStore,
    // to answer subsequent requests
    if(msg.value === undefined && msg.empty === undefined){
      this.stateMachine.localStateStore.add(name, result as Buffer | Empty);
    }

    if (!(result instanceof Buffer)) {
      return null;
    }

    return jsonDeserialize(result.toString());
  }

  public set<T>(name: string, value: T): void {
    this.checkState("set state");
    const msg = this.stateMachine.localStateStore.set(name, value);
    this.stateMachine.handleUserCodeMessage(SET_STATE_ENTRY_MESSAGE_TYPE, msg);
  }

  public clear(name: string): void {
    this.checkState("clear state");

    const msg = this.stateMachine.localStateStore.clear(name);
    this.stateMachine.handleUserCodeMessage(
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  public request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (this.isInOneWayCall()) {
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
    this.checkState("invoke");

    const msg = InvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
    });
    const promise = this.stateMachine.handleUserCodeMessage(
      INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    );
    return (await promise) as Uint8Array;
  }

  private async invokeOneWay(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    const delay = this.getOneWayCallDelay();
    const invokeTime = delay > 0 ? Date.now() + delay : undefined;
    const msg = BackgroundInvokeEntryMessage.create({
      serviceName: service,
      methodName: method,
      parameter: Buffer.from(data),
      invokeTime: invokeTime,
    });

    await this.stateMachine.handleUserCodeMessage(
      BACKGROUND_INVOKE_ENTRY_MESSAGE_TYPE,
      msg
    );
    return new Uint8Array();
  }

  public async oneWayCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: () => Promise<any>
  ): Promise<void> {
    this.checkState("oneWayCall");

    await this.callContext.run(
      { type: CallContexType.OneWayCall },
      call
    );
  }

  public async delayedCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: () => Promise<any>,
    delayMillis?: number
  ): Promise<void> {
    this.checkState("delayedCall");

    // Delayed call is a one way call with a delay
    await this.callContext.run(
      { type: CallContexType.OneWayCall, delay: delayMillis },
      call
    );
  }

  public async sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isInSideEffect()) {
      const msg = "You cannot do sideEffect calls from within a side effect.";
      await this.stateMachine.notifyApiViolation(13, msg);
      throw new Error(msg);
    } else if (this.isInOneWayCall()) {
      const msg =
        "Cannot do a side effect from within ctx.oneWayCall(...). " +
        "Context method ctx.oneWayCall() can only be used to invoke other services unidirectionally. " +
        "e.g. ctx.oneWayCall(() => client.greet(my_request))";
      await this.stateMachine.notifyApiViolation(13, msg);
      throw new Error(msg);
    }

    // in replay mode, we directly return the value from the log
    if (this.stateMachine.nextEntryWillBeReplayed()) {
      const emptyMsg = SideEffectEntryMessage.create({});
      return this.stateMachine.handleUserCodeMessage<T>(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        emptyMsg
      ) as Promise<T>;
    }

    let sideEffectResult: T;
    try {
      sideEffectResult = await this.callContext.run(
        { type: CallContexType.SideEffect },
        fn
      );
    } catch (e) {
      // error that came out of the side-effect execution
      // we send back a completion with a failure
      const errorMessage: string =
        e instanceof Error ? e.message : JSON.stringify(e);
      const failure: Failure = Failure.create({
        code: 13,
        message: errorMessage,
      });

      const sideEffectMsg = SideEffectEntryMessage.encode(
        SideEffectEntryMessage.create({ failure: failure })
      ).finish();

      // this may throw an error from the SDK/runtime/connection side, in case the
      // failure message cannot be committed to the journal. That error would then
      // be returned from this function (replace the original error)
      await this.stateMachine.handleUserCodeMessage<T>(
        SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
        sideEffectMsg,
        false,
        undefined,
        true
      );

      throw new RestateError("sideEffect execution failed: " + errorMessage, e);
    }

    // we have this code outside the above try/catch block, to ensure that any error arising
    // from here is not incorrectly attributed to the side-effect
    const sideEffectMsg =
      sideEffectResult !== undefined
        ? SideEffectEntryMessage.encode(
            SideEffectEntryMessage.create({
              value: Buffer.from(jsonSerialize(sideEffectResult)),
            })
          ).finish()
        : SideEffectEntryMessage.encode(
            SideEffectEntryMessage.create()
          ).finish();

    // if an error arises from committing the side effect result, then this error will
    // be thrown here (reject the returned promise) and the function will see that error,
    // even if the side-effect function completed correctly
    await this.stateMachine.handleUserCodeMessage<T>(
      SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
      sideEffectMsg,
      false,
      undefined,
      true
    );

    return sideEffectResult;
  }

  public sleep(millis: number): Promise<void> {
    this.checkState("sleep");

    const msg = SleepEntryMessage.create({ wakeUpTime: Date.now() + millis });
    return this.stateMachine.handleUserCodeMessage<void>(
      SLEEP_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  public awakeable<T>(): { id: string; promise: Promise<T> } {
    this.checkState("awakeable");

    const msg = AwakeableEntryMessage.create();
    const promise = this.stateMachine
      .handleUserCodeMessage<Buffer>(AWAKEABLE_ENTRY_MESSAGE_TYPE, msg)
      .then((result: Buffer | void) => {
        if (!(result instanceof Buffer)) {
          //TODO What to do if this is not a buffer?
          throw new Error("");
        }

        return JSON.parse(result.toString()) as T;
      });

    // This needs to be done after handling the message in the state machine
    // otherwise the index is not yet incremented.
    const awakeableIdentifier = new AwakeableIdentifier(
      this.stateMachine.getFullServiceName(),
      this.instanceKey,
      this.invocationId,
      this.stateMachine.getUserCodeJournalIndex()
    );

    return {
      id: JSON.stringify(awakeableIdentifier),
      promise: promise,
    };
  }

  public completeAwakeable<T>(id: string, payload: T): void {
    this.checkState("completeAwakeable");

    // Parse the string to an awakeable identifier
    const awakeableIdentifier = JSON.parse(id, (key, value) => {
      if (value !== undefined && value.type === "Buffer") {
        return Buffer.from(value.data);
      }
      return value;
    }) as AwakeableIdentifier;

    const msg = CompleteAwakeableEntryMessage.create({
      serviceName: awakeableIdentifier.serviceName,
      instanceKey: awakeableIdentifier.instanceKey,
      invocationId: awakeableIdentifier.invocationId,
      entryIndex: awakeableIdentifier.entryIndex,
      payload: Buffer.from(JSON.stringify(payload)),
    });

    this.stateMachine.handleUserCodeMessage(
      COMPLETE_AWAKEABLE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  private isInSideEffect(): boolean {
    const context = this.callContext.getStore();
    return context?.type === CallContexType.SideEffect;
  }

  private isInOneWayCall(): boolean {
    const context = this.callContext.getStore();
    return context?.type === CallContexType.OneWayCall;
  }

  private getOneWayCallDelay(): number {
    const context = this.callContext.getStore();
    return context?.delay || 0;
  }

  private checkState(callType: string): void {
    const context = this.callContext.getStore();
    if (!context) {
      return;
    }

    if (context.type === CallContexType.SideEffect) {
      const msg = `You cannot do ${callType} calls from within a side effect.`;
      this.stateMachine.notifyApiViolation(13, msg);
      throw new RestateError(msg);
    }

    if (context.type === CallContexType.OneWayCall) {
      const msg = `Cannot do a ${callType} from within ctx.oneWayCall(...).
          Context method oneWayCall() can only be used to invoke other services in the background.
          e.g. ctx.oneWayCall(() => client.greet(my_request))`;
      this.stateMachine.notifyApiViolation(13, msg);
      throw new RestateError(msg);
    }
  }
}
