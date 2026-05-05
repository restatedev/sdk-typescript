// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import type {
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk";

export type ComponentDefinition =
  | ServiceDefinition<string, unknown>
  | VirtualObjectDefinition<string, unknown>
  | WorkflowDefinition<string, unknown>;

export class ComponentRegistry {
  constructor(
    readonly components: Map<string, ComponentDefinition> = new Map()
  ) {}

  add(c: ComponentDefinition) {
    this.components.set(c.name, c);
  }

  addObject(o: VirtualObjectDefinition<string, unknown>) {
    this.add(o);
  }

  addService(s: ServiceDefinition<string, unknown>) {
    this.add(s);
  }

  addWorkflow(s: WorkflowDefinition<string, unknown>) {
    this.add(s);
  }

  definitions(fqdns?: Set<string>): ComponentDefinition[] {
    if (!fqdns) {
      return Array.from(this.components.values());
    }

    return Array.from(fqdns, (fqdn) => {
      const c = this.components.get(fqdn);
      if (!c) {
        throw new Error(
          `unknown fqdn ${fqdn}. Did you remember to import the test at app.ts?`
        );
      }
      return c;
    });
  }
}

export const REGISTRY = new ComponentRegistry();
