import { RestateContext } from "./restate_context";
import { StateMachine } from "./state_machine";
import {
  AwakeableEntryMessage,
  BackgroundInvokeEntryMessage,
  ClearStateEntryMessage,
  CompleteAwakeableEntryMessage,
  Failure,
  GetStateEntryMessage,
  InvokeEntryMessage,
  OutputStreamEntryMessage,
  SetStateEntryMessage,
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
  OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
  SET_STATE_ENTRY_MESSAGE_TYPE,
  SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
  SLEEP_ENTRY_MESSAGE_TYPE,
} from "./types/protocol";
import { SideEffectEntryMessage } from "./generated/proto/javascript";

export class RestateContextImpl<I, O> implements RestateContext {
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
    public readonly instanceKey: Buffer,
    public readonly invocationId: Buffer,
    public readonly serviceName: string,
    private readonly stateMachine: StateMachine<I, O>
  ) {}

  async get<T>(name: string): Promise<T | null> {
    // Check if this is a valid action
    if (!this.isValidState("get state")) {
      return Promise.reject();
    }

    // Create the message and let the state machine process it
    const msg = GetStateEntryMessage.create({ key: Buffer.from(name) });
    const promise = this.stateMachine.handleUserCodeMessage(
      GET_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );

    // Wait for the result, do post-processing and then deliver it back to the user code.
    return promise.then((result) => {
      if (!(result instanceof Buffer)) {
        return null;
      }
      return JSON.parse(result.toString()) as T;
    });
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
      throw new Error();
    }

    const msg = ClearStateEntryMessage.create({
      key: Buffer.from(name, "utf8"),
    });
    this.stateMachine.handleUserCodeMessage(
      CLEAR_STATE_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
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
    const invokeTime =
      this.oneWayCallDelay > 0 ? Date.now() + this.oneWayCallDelay : undefined;
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

  async oneWayCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: () => Promise<any>,
    delayMillis?: number
  ): Promise<void> {
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

  async sideEffect<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inSideEffectFlag) {
      await this.stateMachine.handleUserCodeMessage(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message: `You cannot do sideEffect calls from within a side effect.`,
          }),
        })
      );
    } else if (this.oneWayCallFlag) {
      await this.stateMachine.handleUserCodeMessage(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message:
              `Cannot do a side effect from within ctx.oneWayCall(...). ` +
              "Context method ctx.oneWayCall() can only be used to invoke other services unidirectionally. " +
              "e.g. ctx.oneWayCall(() => client.greet(my_request))",
          }),
        })
      );
    }

    this.inSideEffectFlag = true;

    return new Promise((resolve, reject) => {
      if (this.stateMachine.isReplaying()) {
        this.inSideEffectFlag = false;
        const emptyMsg = SideEffectEntryMessage.create({});
        const promise = this.stateMachine.handleUserCodeMessage<T>(
          SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
          emptyMsg
        );
        return promise.then(
          (value) => {
            resolve(value as T);
          },
          (failure) => {
            reject(failure);
          }
        );
      } else {
        fn()
          .then((value) => {
            const bytes =
              value !== undefined
                ? Buffer.from(JSON.stringify(value))
                : Buffer.from(JSON.stringify({}));
            const sideEffectMsg = SideEffectEntryMessage.encode(
              SideEffectEntryMessage.create({ value: bytes })
            ).finish();
            const promise = this.stateMachine.handleUserCodeMessage<T>(
              SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
              sideEffectMsg,
              false,
              undefined,
              true
            );

            this.inSideEffectFlag = false;
            promise.then(
              () => resolve(value),
              (failure) => reject(failure)
            );
          })
          .catch((reason) => {
            // Reason is either a failure or an Error
            const failure: Failure =
              reason instanceof Error
                ? Failure.create({
                    code: 13,
                    message: reason.message,
                  })
                : reason;

            const sideEffectMsg = SideEffectEntryMessage.encode(
              SideEffectEntryMessage.create({ failure: failure })
            ).finish();

            const promise = this.stateMachine.handleUserCodeMessage<T>(
              SIDE_EFFECT_ENTRY_MESSAGE_TYPE,
              sideEffectMsg,
              false,
              undefined,
              true
            );

            this.inSideEffectFlag = false;
            promise.then(
              () => reject(failure),
              (failureFromRuntime) => reject(failureFromRuntime)
            );
          });
      }
    });
  }

  sleep(millis: number): Promise<void> {
    if (!this.isValidState("sleep")) {
      return Promise.reject();
    }

    const msg = SleepEntryMessage.create({ wakeUpTime: Date.now() + millis });
    return this.stateMachine.handleUserCodeMessage<void>(
      SLEEP_ENTRY_MESSAGE_TYPE,
      msg
    );
  }

  awakeable<T>(): { id: string; promise: Promise<T> } {
    if (!this.isValidState("awakeable")) {
      throw new Error();
    }

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

  completeAwakeable<T>(id: string, payload: T): void {
    if (!this.isValidState("completeAwakeable")) {
      return;
    }

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

  isValidState(callType: string): boolean {
    if (this.inSideEffectFlag) {
      this.stateMachine.handleUserCodeMessage(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message: `You cannot do ${callType} calls from within a side effect.`,
          }),
        })
      );
      return false;
    } else if (this.oneWayCallFlag) {
      this.stateMachine.handleUserCodeMessage(
        OUTPUT_STREAM_ENTRY_MESSAGE_TYPE,
        OutputStreamEntryMessage.create({
          failure: Failure.create({
            code: 13,
            message: `Cannot do a ${callType} from within ctx.oneWayCall(...).
          Context method oneWayCall() can only be used to invoke other services in the background.
          e.g. ctx.oneWayCall(() => client.greet(my_request))`,
          }),
        })
      );
      return false;
    } else {
      return true;
    }
  }
}
