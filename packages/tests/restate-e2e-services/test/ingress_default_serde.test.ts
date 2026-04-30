// Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
//
// This file is part of the Restate e2e tests,
// which are released under the MIT license.
//
// You can find a copy of the license in file LICENSE in the root
// directory of this repository or package, or at
// https://github.com/restatedev/e2e/blob/main/LICENSE

import { randomUUID } from "node:crypto";
import * as clients from "@restatedev/restate-sdk-clients";
import { rpc } from "@restatedev/restate-sdk-clients";
import { describe, expect, it } from "vitest";
import { getIngressUrl } from "./utils.js";
import {
  type IngressDefaultSerdeAwakeableObject,
  type IngressDefaultSerdeObject,
  type IngressDefaultSerdeService,
  type IngressDefaultSerdeWorkflow,
  type IngressSerdePayload,
  type IngressOverrideSerdeWorkflow,
  ingressDefaultSerde,
  ingressOverrideSerde,
} from "../src/ingress_default_serde.js";

const IngressDefaultSerdeService: IngressDefaultSerdeService = {
  name: "IngressDefaultSerdeService",
};
const IngressDefaultSerdeObject: IngressDefaultSerdeObject = {
  name: "IngressDefaultSerdeObject",
};
const IngressDefaultSerdeAwakeableObject: IngressDefaultSerdeAwakeableObject = {
  name: "IngressDefaultSerdeAwakeableObject",
};
const IngressDefaultSerdeWorkflow: IngressDefaultSerdeWorkflow = {
  name: "IngressDefaultSerdeWorkflow",
};
const IngressOverrideSerdeWorkflow: IngressOverrideSerdeWorkflow = {
  name: "IngressOverrideSerdeWorkflow",
};

describe("Ingress default serde e2e", () => {
  const ingress = clients.connect({
    url: getIngressUrl(),
    serde: ingressDefaultSerde,
  });

  it("uses the connection default serde for service and object calls", async () => {
    const service = ingress.serviceClient(IngressDefaultSerdeService);
    await expect(service.echo({ value: "service-call" })).resolves.toEqual({
      value: "service:service-call",
    });

    const object = ingress.objectClient(
      IngressDefaultSerdeObject,
      randomUUID()
    );
    await expect(object.echo({ value: "object-call" })).resolves.toEqual({
      value: "object:object-call",
    });
  }, 30_000);

  it("lets local serdes override service and object call defaults", async () => {
    const service = ingress.serviceClient(IngressDefaultSerdeService);
    await expect(
      service.echoOverride(
        { value: "service-call" },
        rpc.opts<IngressSerdePayload, IngressSerdePayload>({
          input: ingressOverrideSerde,
          output: ingressOverrideSerde,
        })
      )
    ).resolves.toEqual({ value: "service-override:service-call" });

    const object = ingress.objectClient(
      IngressDefaultSerdeObject,
      randomUUID()
    );
    await expect(
      object.echoOverride(
        { value: "object-call" },
        rpc.opts<IngressSerdePayload, IngressSerdePayload>({
          input: ingressOverrideSerde,
          output: ingressOverrideSerde,
        })
      )
    ).resolves.toEqual({ value: "object-override:object-call" });
  }, 30_000);

  it("uses the connection default serde for workflow submit, attach, and output", async () => {
    const workflow = ingress.workflowClient(
      IngressDefaultSerdeWorkflow,
      randomUUID()
    );

    await workflow.workflowSubmit({ value: "workflow-submit" });

    await expect(workflow.workflowAttach()).resolves.toEqual({
      value: "workflow:workflow-submit",
    });
    await expect(workflow.workflowOutput()).resolves.toEqual({
      ready: true,
      result: { value: "workflow:workflow-submit" },
    });
  }, 30_000);

  it("lets local serdes override workflow submit, attach, and output defaults", async () => {
    const workflow = ingress.workflowClient(
      IngressOverrideSerdeWorkflow,
      randomUUID()
    );

    await workflow.workflowSubmit(
      { value: "workflow-submit" },
      rpc.sendOpts<IngressSerdePayload>({ input: ingressOverrideSerde })
    );

    await expect(
      workflow.workflowAttach(
        rpc.opts<void, IngressSerdePayload>({ output: ingressOverrideSerde })
      )
    ).resolves.toEqual({
      value: "workflow-override:workflow-submit",
    });
    await expect(
      workflow.workflowOutput(
        rpc.opts<void, IngressSerdePayload>({ output: ingressOverrideSerde })
      )
    ).resolves.toEqual({
      ready: true,
      result: { value: "workflow-override:workflow-submit" },
    });
  }, 30_000);

  it("uses the connection default serde for sends and attached results", async () => {
    const serviceSend = await ingress
      .serviceSendClient(IngressDefaultSerdeService)
      .echo(
        { value: "service-send" },
        rpc.sendOpts({ idempotencyKey: randomUUID() })
      );
    await expect(ingress.result(serviceSend)).resolves.toEqual({
      value: "service:service-send",
    });

    const objectSend = await ingress
      .objectSendClient(IngressDefaultSerdeObject, randomUUID())
      .echo(
        { value: "object-send" },
        rpc.sendOpts({ idempotencyKey: randomUUID() })
      );
    await expect(ingress.result(objectSend)).resolves.toEqual({
      value: "object:object-send",
    });
  }, 30_000);

  it("lets local serdes override send input and attached result defaults", async () => {
    const serviceSend = await ingress
      .serviceSendClient(IngressDefaultSerdeService)
      .echoOverride(
        { value: "service-send" },
        rpc.sendOpts({
          idempotencyKey: randomUUID(),
          input: ingressOverrideSerde,
        })
      );
    await expect(
      ingress.result(serviceSend, ingressOverrideSerde)
    ).resolves.toEqual({
      value: "service-override:service-send",
    });

    const objectSend = await ingress
      .objectSendClient(IngressDefaultSerdeObject, randomUUID())
      .echoOverride(
        { value: "object-send" },
        rpc.sendOpts({
          idempotencyKey: randomUUID(),
          input: ingressOverrideSerde,
        })
      );
    await expect(
      ingress.result(objectSend, ingressOverrideSerde)
    ).resolves.toEqual({
      value: "object-override:object-send",
    });
  }, 30_000);

  it("uses the connection default serde for resolving an awakeable", async () => {
    const key = randomUUID();
    const object = ingress.objectClient(
      IngressDefaultSerdeAwakeableObject,
      key
    );

    const send = await ingress
      .objectSendClient(IngressDefaultSerdeAwakeableObject, key)
      .wait({}, rpc.sendOpts({ idempotencyKey: randomUUID() }));

    await expect
      .poll(() => object.getAwakeableId(), { timeout: 10_000 })
      .not.toBeNull();
    const awakeableId = await object.getAwakeableId();
    await ingress.resolveAwakeable(awakeableId!, {
      value: "awakeable-payload",
    });

    await expect(ingress.result(send)).resolves.toEqual({
      value: "awakeable-payload",
    });
  }, 30_000);

  it("lets a local serde override the awakeable resolve default", async () => {
    const key = randomUUID();
    const object = ingress.objectClient(
      IngressDefaultSerdeAwakeableObject,
      key
    );

    const send = await ingress
      .objectSendClient(IngressDefaultSerdeAwakeableObject, key)
      .wait(
        { useOverrideSerde: true },
        rpc.sendOpts({ idempotencyKey: randomUUID() })
      );

    await expect
      .poll(() => object.getAwakeableId(), { timeout: 10_000 })
      .not.toBeNull();
    const awakeableId = await object.getAwakeableId();
    await ingress.resolveAwakeable(
      awakeableId!,
      { value: "awakeable-payload" },
      ingressOverrideSerde
    );

    await expect(ingress.result(send)).resolves.toEqual({
      value: "awakeable-payload",
    });
  }, 30_000);
});
