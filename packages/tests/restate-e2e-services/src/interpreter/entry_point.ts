// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { REGISTRY } from "../services.js";
import { createInterpreterObject } from "./interpreter.js";
import { serviceInterpreterHelper } from "./services.js";

/**
 * Hardcode for now, the Max number of InterpreterObject layers.
 * Each layer is represented by a VirtualObject that implements the ObjectInterpreter interface,
 * And named: `ObjectInterpreterL${layer}.
 *
 * i.e. (for 3 layers we get):
 *
 * ObjectInterpreterL0, ObjectInterpreterL1,ObjectInterpreterL2
 *
 * Each ObjectInterpreter is only allowed to preform blocking calls to the next layer,
 * to avoid deadlocks.
 *
 */

REGISTRY.addService(serviceInterpreterHelper);
REGISTRY.addObject(createInterpreterObject(0));
REGISTRY.addObject(createInterpreterObject(1));
REGISTRY.addObject(createInterpreterObject(2));
