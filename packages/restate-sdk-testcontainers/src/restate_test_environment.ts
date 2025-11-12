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

import {
  endpoint,
  createEndpointHandler,
  serde,
} from "@restatedev/restate-sdk";
import type {
  TypedState,
  UntypedState,
  Serde,
  RestateEndpoint,
  VirtualObjectDefinition,
  WorkflowDefinition,
  EndpointOptions,
} from "@restatedev/restate-sdk";

import {
  GenericContainer,
  type StartedTestContainer,
  TestContainers,
  Wait,
} from "testcontainers";
import { tableFromIPC } from "apache-arrow";
import * as http2 from "http2";
import type * as net from "net";

// Prepare the restate server
async function prepareRestateEndpoint(
  param: (server: RestateEndpoint) => void
): Promise<http2.Http2Server>;
async function prepareRestateEndpoint(
  param: EndpointOptions
): Promise<http2.Http2Server>;
async function prepareRestateEndpoint(
  param: EndpointOptions | ((server: RestateEndpoint) => void)
): Promise<http2.Http2Server> {
  // Prepare RestateServer
  let handler: (
    request: http2.Http2ServerRequest,
    response: http2.Http2ServerResponse
  ) => void;
  if (typeof param === "function") {
    const restateEndpoint = endpoint();
    param(restateEndpoint);
    handler = restateEndpoint.http2Handler();
  } else {
    handler = createEndpointHandler(param);
  }

  // Start HTTP2 server on random port
  const restateHttpServer = http2.createServer(handler);
  await new Promise((resolve, reject) => {
    restateHttpServer
      .listen(0)
      .once("listening", resolve)
      .once("error", reject);
  });
  const restateServerPort = (restateHttpServer.address() as net.AddressInfo)
    .port;
  console.info(`Restate container listening on port ${restateServerPort}`);

  return restateHttpServer;
}

// Prepare the restate testcontainer
async function prepareRestateTestContainer(
  restateServerPort: number,
  restateContainerFactory: () => GenericContainer
): Promise<StartedTestContainer> {
  const restateContainer = restateContainerFactory()
    // Expose ports
    .withExposedPorts(8080, 9070)
    // Wait start on health checks
    .withWaitStrategy(
      Wait.forAll([
        Wait.forHttp("/restate/health", 8080),
        Wait.forHttp("/health", 9070),
      ])
    );

  // This MUST be executed before starting the restate container
  // Expose host port to access the restate server
  await TestContainers.exposeHostPorts(restateServerPort);

  // Start restate container
  const startedRestateContainer = await restateContainer.start();

  // From now on, if something fails, stop the container to cleanup the environment
  try {
    console.info(
      `Registering services at http://host.testcontainers.internal:${restateServerPort}...`
    );

    // Register this service endpoint
    const res = await fetch(
      `http://${startedRestateContainer.getHost()}:${startedRestateContainer.getMappedPort(
        9070
      )}/deployments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // See https://node.testcontainers.org/features/networking/#expose-host-ports-to-container
          uri: `http://host.testcontainers.internal:${restateServerPort}`,
        }),
      }
    );
    if (!res.ok) {
      const badResponse = await res.text();
      throw new Error(
        `Error ${res.status} during registration: ${badResponse}`
      );
    }

    const resp = (await res.json()) as { services: { name: string }[] };
    console.info(
      "Registered services:",
      resp?.services?.map((s) => s.name)
    );
    return startedRestateContainer;
  } catch (e) {
    await startedRestateContainer.stop();
    throw e;
  }
}

export class RestateTestEnvironment {
  constructor(
    readonly startedRestateHttpServer: http2.Http2Server,
    readonly startedRestateContainer: StartedTestContainer
  ) {}

  public baseUrl(): string {
    return `http://${this.startedRestateContainer.getHost()}:${this.startedRestateContainer.getMappedPort(
      8080
    )}`;
  }

  public adminAPIBaseUrl(): string {
    return `http://${this.startedRestateContainer.getHost()}:${this.startedRestateContainer.getMappedPort(
      9070
    )}`;
  }

  // Create a handle that allows read/write of state under a given Virtual Object/Workflow key.
  public stateOf<TState extends TypedState = UntypedState>(
    service:
      | VirtualObjectDefinition<string, unknown>
      | WorkflowDefinition<string, unknown>,
    key: string
  ): StateProxy<TState> {
    return new StateProxy(this.adminAPIBaseUrl(), service.name, key);
  }

  public async stop() {
    await this.startedRestateContainer.stop();
    this.startedRestateHttpServer.close();
  }

  /**
   *
   * @deprecated Please use {@link EndpointOptions} instead of this.
   * @example
   * ```
   * RestateTestEnvironment.start({ services: [mysService] })
   * ```
   */
  public static async start(
    mountServicesFn: (server: RestateEndpoint) => void,
    restateContainerFactory?: () => GenericContainer
  ): Promise<RestateTestEnvironment>;
  public static async start(
    options: EndpointOptions,
    restateContainerFactory?: () => GenericContainer
  ): Promise<RestateTestEnvironment>;
  public static async start(
    param: EndpointOptions | ((server: RestateEndpoint) => void),
    restateContainerFactory: () => GenericContainer = () =>
      new RestateContainer()
  ): Promise<RestateTestEnvironment> {
    const startedRestateHttpServer =
      typeof param === "function"
        ? await prepareRestateEndpoint(param)
        : await prepareRestateEndpoint(param);
    const startedRestateContainer = await prepareRestateTestContainer(
      (startedRestateHttpServer.address() as net.AddressInfo).port,
      restateContainerFactory
    );
    return new RestateTestEnvironment(
      startedRestateHttpServer,
      startedRestateContainer
    );
  }
}

export class RestateContainer extends GenericContainer {
  constructor(version = "latest") {
    super(`docker.io/restatedev/restate:${version}`);
  }
}
export class StateProxy<TState extends TypedState> {
  constructor(
    private adminAPIBaseUrl: string,
    private service: string,
    private serviceKey: string
  ) {}

  // Read a single value from state under a given Virtual Object or Workflow key
  public async get<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    serde?: Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): Promise<(TState extends UntypedState ? TValue : TState[TKey]) | null> {
    serde = serde ?? defaultSerde();

    const res = await fetch(`${this.adminAPIBaseUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `SELECT value from state where service_name = '${
          this.service
        }' and service_key = '${this.serviceKey}' and key = '${String(name)}';`,
      }),
    });

    if (!res.ok) {
      const badResponse = await res.text();
      throw new Error(`Error ${res.status} during read state: ${badResponse}`);
    }

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const table = (await tableFromIPC(res.body)).toArray() as {
      key: string;
      value: Uint8Array;
    }[];

    if (table.length === 0) {
      return null;
    }

    return serde.deserialize(table[0]!.value);
  }

  // Read all values from state under a given Virtual Object or Workflow key
  public async getAll<TValues extends TypedState>(
    serde?: Serde<
      TState extends UntypedState
        ? TValues[keyof TValues]
        : TState[keyof TState]
    >
  ): Promise<TState extends UntypedState ? TValues : TState> {
    serde = serde ?? defaultSerde();

    const items = await this.getAllRaw();

    return Object.fromEntries(
      items.map(({ key, value }) => {
        return [key, serde.deserialize(value)];
      })
    ) as TState extends UntypedState ? TValues : TState;
  }

  private async getAllRaw(): Promise<{ key: string; value: Uint8Array }[]> {
    const res = await fetch(`${this.adminAPIBaseUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `SELECT key, value from state where service_name = '${this.service}' and service_key = '${this.serviceKey}';`,
      }),
    });

    if (!res.ok) {
      const badResponse = await res.text();
      throw new Error(`Error ${res.status} during read state: ${badResponse}`);
    }

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const table = (await tableFromIPC(res.body)).toArray() as {
      key: string;
      value: Uint8Array;
    }[];

    return table;
  }

  // Asynchronously set a single value from state under a given Virtual Object or Workflow key.
  // This will first read all values, then insert the update and submit the new set of values to Restate;
  // as such it is possible to overwrite changes that happened between the read and the mutation being applied.
  // A successful return from this function does not imply that the set has finished, only that the mutation
  // was submitted to Restate for processing.
  public async set<TValue, TKey extends keyof TState = string>(
    name: TState extends UntypedState ? string : TKey,
    value: TState extends UntypedState ? TValue : TState[TKey],
    serde?: Serde<TState extends UntypedState ? TValue : TState[TKey]>
  ): Promise<void> {
    serde = serde ?? defaultSerde();
    const serialisedValue = serde.serialize(value);

    const items = await this.getAllRaw();

    items.push({ key: String(name), value: serialisedValue });

    await this.setAllRaw(items.map(({ key, value }) => [key, value]));
  }

  // Asynchronously set all state values under a given Virtual Object or Workflow key.
  // A successful return from this function does not imply that the set has finished,
  // only that the mutation was submitted to Restate for processing.
  public async setAll<TValues extends TypedState>(
    values: TState extends UntypedState ? TValues : TState,
    serde?: Serde<
      TState extends UntypedState
        ? TValues[keyof TValues]
        : TState[keyof TState]
    >
  ) {
    serde = serde ?? defaultSerde();

    return this.setAllRaw(
      Object.entries<
        TState extends UntypedState
          ? TValues[keyof TValues]
          : TState[keyof TState]
      >(values).map(([key, value]) => {
        return [key, serde.serialize(value)];
      })
    );
  }

  private async setAllRaw(
    entries: [key: string, value: Uint8Array][],
    version?: string
  ) {
    const res = await fetch(
      `${this.adminAPIBaseUrl}/services/${this.service}/state`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          {
            version,
            object_key: this.serviceKey,
            new_state: Object.fromEntries(entries),
          },
          (key, value) => {
            if (value instanceof Uint8Array) {
              return Array.from(value);
            } else {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return value;
            }
          }
        ),
      }
    );

    if (!res.ok) {
      const badResponse = await res.text();
      throw new Error(
        `Error ${res.status} during modify state: ${badResponse}`
      );
    }
  }
}

export const defaultSerde = <T>(): Serde<T> => {
  return serde.json as Serde<T>;
};
