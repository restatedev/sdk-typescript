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

import * as http from "node:http";
import * as net from "node:net";
import { RestateContainer } from "@restatedev/restate-sdk-testcontainers";
import {
  createEndpointHandler,
  service,
  type Context,
} from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  TestContainers,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { describe, it, beforeAll, afterAll, expect } from "vitest";

const greeter = service({
  name: "greeter",
  handlers: {
    greet: async (ctx: Context, name: string) => {
      return `Hello ${name}`;
    },
  },
});

function defineHttp1Tests(
  label: string,
  handlerFactory: () => http.RequestListener
) {
  describe(label, () => {
    let httpServer: http.Server;
    let restateContainer: StartedTestContainer;
    let rs: clients.Ingress;

    beforeAll(async () => {
      httpServer = http.createServer(handlerFactory());
      await new Promise<void>((resolve, reject) => {
        httpServer.listen(0).once("listening", resolve).once("error", reject);
      });
      const port = (httpServer.address() as net.AddressInfo).port;

      await TestContainers.exposeHostPorts(port);

      restateContainer = await new RestateContainer()
        .withExposedPorts(8080, 9070)
        .withWaitStrategy(
          Wait.forAll([
            Wait.forHttp("/restate/health", 8080),
            Wait.forHttp("/health", 9070),
          ])
        )
        .start();

      const adminUrl = `http://${restateContainer.getHost()}:${restateContainer.getMappedPort(9070)}`;
      const res = await fetch(`${adminUrl}/deployments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uri: `http://host.testcontainers.internal:${port}`,
          use_http_11: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Registration failed (${res.status}): ${body}`);
      }

      const ingressUrl = `http://${restateContainer.getHost()}:${restateContainer.getMappedPort(8080)}`;
      rs = clients.connect({ url: ingressUrl });
    }, 30_000);

    afterAll(async () => {
      if (restateContainer) {
        await restateContainer.stop();
      }
      if (httpServer) {
        httpServer.close();
      }
    });

    it("Can call a service over HTTP/1.1", async () => {
      const client = rs.serviceClient(greeter);
      const result = await client.greet("Restate");
      expect(result).toBe("Hello Restate");
    });
  });
}

defineHttp1Tests("HTTP/1.1 endpoint (request-response)", () =>
  createEndpointHandler({ services: [greeter] })
);

defineHttp1Tests("HTTP/1.1 endpoint (bidirectional)", () =>
  createEndpointHandler({ services: [greeter], bidirectional: true })
);
