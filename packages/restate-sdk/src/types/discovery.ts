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

export enum ServiceType {
  VIRTUAL_OBJECT = "VIRTUAL_OBJECT",
  SERVICE = "SERVICE",
  WORKFLOW = "WORKFLOW",
}

export enum ServiceHandlerType {
  WORKFLOW = "WORKFLOW",
  EXCLUSIVE = "EXCLUSIVE",
  SHARED = "SHARED",
}

type InputPayload = {
  required: boolean;
  contentType: string;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  jsonSchema?: any; // You should specify the type of jsonSchema if known
};

type OutputPayload = {
  contentType: string;
  setContentTypeIfEmpty: boolean;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  jsonSchema?: any; // You should specify the type of jsonSchema if known
};

export interface Handler {
  name: string;
  ty?: ServiceHandlerType; // If unspecified, defaults to EXCLUSIVE for Virtual Object. This should be unset for Services.
  input?: InputPayload;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  output?: OutputPayload;
}

export interface Service {
  name: string;
  ty: ServiceType;
  handlers: Handler[];
}

export interface Endpoint {
  protocolMode: ProtocolMode;
  minProtocolVersion: number;
  maxProtocolVersion: number;
  services: Service[];
}
