/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

export enum ProtocolMode {
  BIDI_STREAM = "BIDI_STREAM",
  REQUEST_RESPONSE = "REQUEST_RESPONSE",
}

export enum ComponentType {
  VIRTUAL_OBJECT = "VIRTUAL_OBJECT",
  SERVICE = "SERVICE",
}

export interface Handler {
  name: string;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  inputSchema?: any;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  outputSchema?: any;
}

export interface Component {
  fullyQualifiedComponentName: string;
  componentType: ComponentType;
  handlers: Handler[];
}

export interface Deployment {
  protocolMode: ProtocolMode;
  minProtocolVersion: number;
  maxProtocolVersion: number;
  components: Component[];
}
