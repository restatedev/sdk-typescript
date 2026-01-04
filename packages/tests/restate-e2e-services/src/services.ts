// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import type {
  RestateEndpoint,
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
} from "@restatedev/restate-sdk";

export type IComponent = {
  fqdn: string;
  binder: (endpoint: RestateEndpoint) => void;
};

export class ComponentRegistry {
  constructor(readonly components: Map<string, IComponent> = new Map()) {}

  add(c: IComponent) {
    this.components.set(c.fqdn, c);
  }

  addObject(o: VirtualObjectDefinition<string, unknown>) {
    this.add({
      fqdn: o.name,
      binder: (b) => b.bind(o),
    });
  }

  addService(s: ServiceDefinition<string, unknown>) {
    this.add({
      fqdn: s.name,
      binder: (b) => b.bind(s),
    });
  }

  addWorkflow(s: WorkflowDefinition<string, unknown>) {
    this.add({
      fqdn: s.name,
      binder: (b) => b.bind(s),
    });
  }

  register(fqdns: Set<string>, e: RestateEndpoint) {
    fqdns.forEach((fqdn) => {
      const c = this.components.get(fqdn);
      if (!c) {
        throw new Error(
          `unknown fqdn ${fqdn}. Did you remember to import the test at app.ts?`
        );
      }
      c.binder(e);
    });
  }
}

export const REGISTRY = new ComponentRegistry();
