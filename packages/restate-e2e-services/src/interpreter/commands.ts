// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

/// Command AST

export enum CommandType {
  SET_STATE = 1,
  GET_STATE = 2,
  CLEAR_STATE = 3,
  INCREMENT_STATE_COUNTER = 4,
  INCREMENT_STATE_COUNTER_INDIRECTLY = 5,
  SLEEP = 6,
  CALL_SERVICE = 7,
  CALL_SLOW_SERVICE = 8,
  INCREMENT_VIA_DELAYED_CALL = 9,
  SIDE_EFFECT = 10,
  THROWING_SIDE_EFFECT = 11,
  SLOW_SIDE_EFFECT = 12,
  RECOVER_TERMINAL_CALL = 13,
  RECOVER_TERMINAL_MAYBE_UN_AWAITED = 14,
  AWAIT_PROMISE = 15,
  RESOLVE_AWAKEABLE = 16,
  REJECT_AWAKEABLE = 17,
  INCREMENT_STATE_COUNTER_VIA_AWAKEABLE = 18,
  CALL_NEXT_LAYER_OBJECT = 19,
}

export type Command =
  | SetState
  | GetState
  | ClearState
  | IncrementStateCounter
  | Sleep
  | CallService
  | IncrementViaDelayedCall
  | SideEffect
  | SlowSideEffect
  | CallSlowService
  | RecoverTerminalCall
  | RecoverTerminalCallMaybeUnAwaited
  | ThrowingSideEffect
  | IncrementStateCounterIndirectly
  | AwaitPromise
  | ResolveAwakeable
  | RejectAwakeable
  | IncrementStateCounterViaAwakeable
  | CallObject;

export type Program = {
  commands: Command[];
};

//
// no parameters
//
export type IncrementStateCounter = {
  kind: CommandType.INCREMENT_STATE_COUNTER;
};

export type RecoverTerminalCall = {
  kind: CommandType.RECOVER_TERMINAL_CALL;
};

export type RecoverTerminalCallMaybeUnAwaited = {
  kind: CommandType.RECOVER_TERMINAL_MAYBE_UN_AWAITED;
};

export type ThrowingSideEffect = {
  kind: CommandType.THROWING_SIDE_EFFECT;
};

export type SlowSideEffect = {
  kind: CommandType.SLOW_SIDE_EFFECT;
};

export type IncrementStateCounterIndirectly = {
  kind: CommandType.INCREMENT_STATE_COUNTER_INDIRECTLY;
};

export type ResolveAwakeable = {
  kind: CommandType.RESOLVE_AWAKEABLE;
};

export type RejectAwakeable = {
  kind: CommandType.REJECT_AWAKEABLE;
};

export type IncrementStateCounterViaAwakeable = {
  kind: CommandType.INCREMENT_STATE_COUNTER_VIA_AWAKEABLE;
};

export type CallService = {
  kind: CommandType.CALL_SERVICE;
};

export type SideEffect = {
  kind: CommandType.SIDE_EFFECT;
};

// state

export type GetState = {
  kind: CommandType.GET_STATE;
  key: number;
};

export type ClearState = {
  kind: CommandType.CLEAR_STATE;
  key: number;
};

export type SetState = {
  kind: CommandType.SET_STATE;
  key: number;
};

// special

export type Sleep = {
  kind: CommandType.SLEEP;
  duration: number;
};

export type IncrementViaDelayedCall = {
  kind: CommandType.INCREMENT_VIA_DELAYED_CALL;
  duration: number;
};

export type AwaitPromise = {
  kind: CommandType.AWAIT_PROMISE;
  index: number;
};

export type CallSlowService = {
  kind: CommandType.CALL_SLOW_SERVICE;
  sleep: number;
};

export type CallObject = {
  kind: CommandType.CALL_NEXT_LAYER_OBJECT;
  key: number;
  program: Program;
};
