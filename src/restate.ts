"use strict";

import * as types from "./types";
import { MethodSpec, MethodOpts, RestateMethod, RestateContext } from "./core";

export class Restate {
  readonly #fns: Record<string, MethodSpec> = {};

  bind(opts: MethodOpts) {
    const spec = MethodSpec.fromOpts(opts);
    this.#fns[spec.method] = spec;
  }

  async listen(port: number) {
    console.log("hello");
  }
}
