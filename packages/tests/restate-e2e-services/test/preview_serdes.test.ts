// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { rpc } from "@restatedev/restate-sdk-clients";
import { describe, expect, it } from "vitest";
import { getAdminUrl, getIngressUrl, ingressClient } from "./utils.js";
import {
  type PreviewSerdeCases,
  type PreviewSerdeServiceDefault,
  explicitAInputSerde,
  explicitAOutputSerde,
  explicitBInputSerde,
  explicitBOutputSerde,
  handlerDefaultSerde,
  serviceDefaultSerde,
} from "../src/preview_serdes.js";

const PreviewSerdeCases: PreviewSerdeCases = { name: "PreviewSerdeCases" };
const PreviewSerdeServiceDefault: PreviewSerdeServiceDefault = {
  name: "PreviewSerdeServiceDefault",
};

async function serviceMetadata(
  serviceName: string
): Promise<Record<string, string>> {
  const response = await fetch(`${getAdminUrl()}/services/${serviceName}`);
  expect(response.status).toBe(200);
  const service = (await response.json()) as {
    metadata?: Record<string, string>;
  };
  return service.metadata ?? {};
}

// Preview encode/decode go through the admin API's internal service proxy:
//   POST /internal/services/{service}/serdes/encode/{serdeName}
//   POST /internal/services/{service}/serdes/decode/{serdeName}
// For a handler's IO the serde name is `{handlerName}/input` or
// `{handlerName}/output`.
function previewEncode(
  serviceName: string,
  serdeName: string,
  json: unknown
): Promise<Response> {
  return fetch(
    `${getAdminUrl()}/internal/services/${serviceName}/serdes/encode/${serdeName}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(json),
    }
  );
}

function previewDecode(
  serviceName: string,
  serdeName: string,
  body: Uint8Array
): Promise<Response> {
  return fetch(
    `${getAdminUrl()}/internal/services/${serviceName}/serdes/decode/${serdeName}`,
    {
      method: "POST",
      body,
    }
  );
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe("Preview serdes e2e", () => {
  const ingress = ingressClient();

  it("explicit input/output serdes invoke correctly", async () => {
    const explicitA = await ingress
      .serviceClient(PreviewSerdeCases)
      .explicitA(
        { value: "alpha" },
        rpc.opts({ input: explicitAInputSerde, output: explicitAOutputSerde })
      );
    const explicitB = await ingress
      .serviceClient(PreviewSerdeCases)
      .explicitB(
        { value: "beta" },
        rpc.opts({ input: explicitBInputSerde, output: explicitBOutputSerde })
      );

    expect(explicitA).toEqual({ value: "explicit-a:alpha" });
    expect(explicitB).toEqual({ value: "explicit-b:beta" });
  }, 30_000);

  it("handler-level default serde applies to input and output", async () => {
    const result = await ingress
      .serviceClient(PreviewSerdeCases)
      .handlerDefault(
        { value: "gamma" },
        rpc.opts({ input: handlerDefaultSerde, output: handlerDefaultSerde })
      );

    expect(result).toEqual({ value: "handler-default:gamma" });
  }, 30_000);

  it("service-level default serde applies to input and output", async () => {
    const result = await ingress
      .serviceClient(PreviewSerdeServiceDefault)
      .invoke(
        { value: "delta" },
        rpc.opts({ input: serviceDefaultSerde, output: serviceDefaultSerde })
      );

    expect(result).toEqual({ value: "service-default:delta" });
  }, 30_000);

  it("falls back to json serde when nothing is specified", async () => {
    const result = await ingress
      .serviceClient(PreviewSerdeCases)
      .jsonDefault({ value: "epsilon" });

    expect(result).toEqual({ value: "json-default:epsilon" });
  }, 30_000);

  it("advertises preview metadata at the service level", async () => {
    const casesMetadata = await serviceMetadata("PreviewSerdeCases");
    const serviceDefaultMetadata = await serviceMetadata(
      "PreviewSerdeServiceDefault"
    );

    expect(casesMetadata).toMatchObject({
      "dev.restate.serde.preview.explicitA/input": "true",
      "dev.restate.serde.preview.explicitA/output": "true",
      "dev.restate.serde.preview.explicitB/input": "true",
      "dev.restate.serde.preview.explicitB/output": "true",
      "dev.restate.serde.preview.handlerDefault/input": "true",
      "dev.restate.serde.preview.handlerDefault/output": "true",
    });
    expect(
      casesMetadata["dev.restate.serde.preview.noPreview/input"]
    ).toBeUndefined();
    expect(
      casesMetadata["dev.restate.serde.preview.noPreview/output"]
    ).toBeUndefined();
    expect(
      casesMetadata["dev.restate.serde.preview.jsonDefault/input"]
    ).toBeUndefined();
    expect(
      casesMetadata["dev.restate.serde.preview.jsonDefault/output"]
    ).toBeUndefined();

    expect(serviceDefaultMetadata).toMatchObject({
      "dev.restate.serde.preview.invoke/input": "true",
      "dev.restate.serde.preview.invoke/output": "true",
    });
  }, 30_000);

  describe("preview encode/decode endpoints", () => {
    it("round-trip explicit handler serdes with distinct prefixes", async () => {
      // explicitA/input: encode then decode the same bytes back
      const encodedA = await previewEncode(
        "PreviewSerdeCases",
        "explicitA/input",
        { value: "in-a" }
      );
      expect(encodedA.status).toBe(200);
      const encodedABytes = await responseBytes(encodedA);
      expect(new TextDecoder().decode(encodedABytes)).toEqual(
        'explicit-a-input:{"value":"in-a"}'
      );

      const decodedA = await previewDecode(
        "PreviewSerdeCases",
        "explicitA/input",
        encodedABytes
      );
      expect(decodedA.status).toBe(200);
      expect(await decodedA.json()).toEqual({ value: "in-a" });

      // explicitB/output: same pattern, different serde
      const encodedB = await previewEncode(
        "PreviewSerdeCases",
        "explicitB/output",
        { value: "out-b" }
      );
      expect(encodedB.status).toBe(200);
      const encodedBBytes = await responseBytes(encodedB);
      expect(new TextDecoder().decode(encodedBBytes)).toEqual(
        'explicit-b-output:{"value":"out-b"}'
      );

      const decodedB = await previewDecode(
        "PreviewSerdeCases",
        "explicitB/output",
        encodedBBytes
      );
      expect(decodedB.status).toBe(200);
      expect(await decodedB.json()).toEqual({ value: "out-b" });
    }, 30_000);

    it("round-trip handler and service default serdes", async () => {
      // handlerDefault/input: handler-level default serde
      const encodedHandler = await previewEncode(
        "PreviewSerdeCases",
        "handlerDefault/input",
        { value: "handler-input" }
      );
      expect(encodedHandler.status).toBe(200);
      const encodedHandlerBytes = await responseBytes(encodedHandler);
      expect(new TextDecoder().decode(encodedHandlerBytes)).toEqual(
        'handler-default:{"value":"handler-input"}'
      );

      const decodedHandler = await previewDecode(
        "PreviewSerdeCases",
        "handlerDefault/input",
        encodedHandlerBytes
      );
      expect(decodedHandler.status).toBe(200);
      expect(await decodedHandler.json()).toEqual({ value: "handler-input" });

      // invoke/output: service-level default serde
      const encodedService = await previewEncode(
        "PreviewSerdeServiceDefault",
        "invoke/output",
        { value: "service-output" }
      );
      expect(encodedService.status).toBe(200);
      const encodedServiceBytes = await responseBytes(encodedService);
      expect(new TextDecoder().decode(encodedServiceBytes)).toEqual(
        'service-default:{"value":"service-output"}'
      );

      const decodedService = await previewDecode(
        "PreviewSerdeServiceDefault",
        "invoke/output",
        encodedServiceBytes
      );
      expect(decodedService.status).toBe(200);
      expect(await decodedService.json()).toEqual({ value: "service-output" });
    }, 30_000);

    it("returns 500 for serdes without preview", async () => {
      const response = await previewEncode(
        "PreviewSerdeCases",
        "noPreview/input",
        { value: "ignored" }
      );

      expect(response.status).toBe(500);
    }, 30_000);

    it("returns 500 for serde names that do not exist", async () => {
      const response = await previewEncode(
        "PreviewSerdeCases",
        "does-not-exist",
        { value: "ignored" }
      );

      expect(response.status).toBe(500);
    }, 30_000);

    it("preview-encoded bytes round-trip through the handler via ingress", async () => {
      // 1. Preview-encode a value into the handler's declared wire format.
      const encodeResp = await previewEncode(
        "PreviewSerdeCases",
        "explicitA/input",
        { value: "via-preview" }
      );
      expect(encodeResp.status).toBe(200);
      const requestBytes = await responseBytes(encodeResp);

      // 2. POST those raw bytes straight to the Restate ingress for the
      //    handler, with the content-type the input serde advertised.
      //    This proves the serde resolved by `/serdes/.../encode/...` is the
      //    same instance used to deserialize the handler's input.
      const invokeResp = await fetch(
        `${getIngressUrl()}/PreviewSerdeCases/explicitA`,
        {
          method: "POST",
          headers: { "content-type": "application/x-explicit-a-input+json" },
          body: requestBytes,
        }
      );
      expect(invokeResp.status).toBe(200);
      const responseBodyBytes = await responseBytes(invokeResp);

      // 3. Feed the handler's response bytes through the decode endpoint for
      //    the output serde — confirms the output serde is the same instance
      //    too.
      const decodeResp = await previewDecode(
        "PreviewSerdeCases",
        "explicitA/output",
        responseBodyBytes
      );
      expect(decodeResp.status).toBe(200);
      expect(await decodeResp.json()).toEqual({
        value: "explicit-a:via-preview",
      });
    }, 30_000);
  });
});
