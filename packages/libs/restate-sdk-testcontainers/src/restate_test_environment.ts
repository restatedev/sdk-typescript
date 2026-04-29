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

import { createEndpointHandler, serde } from "@restatedev/restate-sdk";
import type {
  TypedState,
  UntypedState,
  Serde,
  VirtualObjectDefinition,
  WorkflowDefinition,
  EndpointOptions,
} from "@restatedev/restate-sdk";

import {
  GenericContainer,
  type StartedTestContainer,
  TestContainers,
  Wait,
  type WaitStrategy,
  type BoundPorts,
  getContainerRuntimeClient,
} from "testcontainers";
import { tableFromIPC } from "apache-arrow";
import * as http2 from "http2";
import type * as net from "net";

export type ServiceEndpointAccess = "testcontainers" | "docker-host";

export type TestEnvironmentStorage = "disk" | "memory";

interface ResolvedTestEnvironmentOptions {
  serviceEndpointAccess: ServiceEndpointAccess;
  storage: TestEnvironmentStorage;
}

const DEFAULT_START_OPTIONS: ResolvedTestEnvironmentOptions = {
  serviceEndpointAccess: "docker-host",
  storage: "memory",
};

/**
 * Custom wait strategy that waits for Restate partitions to be ready by
 * executing a SQL query against the admin API. This ensures all partitions
 * are initialized and queryable before the container is considered ready.
 */
class PartitionsReadyWaitStrategy implements WaitStrategy {
  private startupTimeoutMs = 60_000;
  private startupTimeoutSet = false;
  private readonly port: number;
  private readonly pollIntervalMs: number;

  constructor(port = 9070, pollIntervalMs = 200) {
    this.port = port;
    this.pollIntervalMs = pollIntervalMs;
  }

  public withStartupTimeout(startupTimeoutMs: number): this {
    this.startupTimeoutMs = startupTimeoutMs;
    this.startupTimeoutSet = true;
    return this;
  }

  public isStartupTimeoutSet(): boolean {
    return this.startupTimeoutSet;
  }

  public getStartupTimeout(): number {
    return this.startupTimeoutMs;
  }

  public async waitUntilReady(
    container: { id: string },
    boundPorts: BoundPorts
  ): Promise<void> {
    const client = await getContainerRuntimeClient();
    const host = client.info.containerRuntime.host;
    const mappedPort = boundPorts.getBinding(this.port);
    const adminUrl = `http://${host}:${mappedPort}`;

    const startTime = Date.now();

    while (Date.now() - startTime < this.startupTimeoutMs) {
      try {
        const res = await fetch(`${adminUrl}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: "SELECT count(1) FROM sys_invocation",
          }),
        });

        if (res.ok) {
          // Partitions are ready
          return;
        }
      } catch {
        // Ignore errors, keep polling
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new Error(
      `Restate partitions not ready after ${this.startupTimeoutMs}ms`
    );
  }
}

// Prepare the restate server
async function prepareRestateEndpoint(
  param: EndpointOptions
): Promise<http2.Http2Server> {
  // Prepare RestateServer
  const handler: (
    request: http2.Http2ServerRequest,
    response: http2.Http2ServerResponse
  ) => void = createEndpointHandler(param);

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
  restateContainerFactory: () => GenericContainer,
  options: ResolvedTestEnvironmentOptions
): Promise<StartedTestContainer> {
  let restateContainer = restateContainerFactory()
    // Expose ports
    .withExposedPorts(8080, 9070)
    // Wait start on health checks and partition readiness
    .withWaitStrategy(
      Wait.forAll([
        Wait.forHttp("/restate/health", 8080),
        Wait.forHttp("/health", 9070),
        new PartitionsReadyWaitStrategy(),
      ])
    );

  if (options.storage === "memory") {
    restateContainer = restateContainer.withTmpFs({ "/restate-data": "rw" });
  }

  const serviceEndpointHost =
    options.serviceEndpointAccess === "docker-host"
      ? "host.docker.internal"
      : "host.testcontainers.internal";

  if (options.serviceEndpointAccess === "docker-host") {
    restateContainer = restateContainer.withExtraHosts([
      { host: "host.docker.internal", ipAddress: "host-gateway" },
    ]);
  } else {
    // This MUST be executed before starting the restate container.
    // Expose host port to access the restate server.
    await TestContainers.exposeHostPorts(restateServerPort);
  }

  // Start restate container
  const startedRestateContainer = await restateContainer.start();

  // From now on, if something fails, stop the container to cleanup the environment
  try {
    console.info(
      `Registering services at http://${serviceEndpointHost}:${restateServerPort}...`
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
          uri: `http://${serviceEndpointHost}:${restateServerPort}`,
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

export interface TestEnvironmentOptions extends EndpointOptions {
  /**
   * Factory for the Restate container used by the test environment.
   *
   * Use this to customize the Restate image or container settings before the
   * helper applies its own ports, wait strategy, networking, and storage
   * configuration.
   *
   * For backwards compatibility, the second `start(options, factory)` argument
   * is still supported and takes precedence over this option.
   *
   * @defaultValue `() => new RestateContainer()`
   */
  container?: () => GenericContainer;

  /**
   * Controls how the Restate container reaches the SDK service endpoint running
   * on the test host.
   *
   * - `"testcontainers"` exposes the host port through Testcontainers and
   *   registers `http://host.testcontainers.internal:<port>`.
   * - `"docker-host"` skips Testcontainers port exposure, adds
   *   `host.docker.internal:host-gateway` to the Restate container, and
   *   registers `http://host.docker.internal:<port>`.
   *
   * @defaultValue `"docker-host"`
   */
  serviceEndpointAccess?: ServiceEndpointAccess;

  /**
   * Controls where Restate stores container data.
   *
   * - `"disk"` keeps the current Testcontainers/Docker storage behavior.
   * - `"memory"` mounts `/restate-data` as tmpfs for faster disposable tests.
   *
   * @defaultValue `"memory"`
   */
  storage?: TestEnvironmentStorage;

  /**
   * Forces restate-server to always replay on a suspension point.
   * This is useful to hunt non-deterministic bugs that might prevent
   * your code from replaying correctly.
   */
  alwaysReplay?: boolean;

  /**
   * Disables retries in the restate-server invoker.
   * This is useful in tests so that failures surface immediately
   * instead of hanging through retry backoff.
   */
  disableRetries?: boolean;
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

  public static async start(
    options: TestEnvironmentOptions,
    restateContainerFactory?: () => GenericContainer
  ): Promise<RestateTestEnvironment> {
    let containerFactory: () => GenericContainer;
    if (restateContainerFactory) {
      containerFactory = restateContainerFactory;
    } else if (options.container) {
      containerFactory = options.container;
    } else {
      containerFactory = () => {
        const container = new RestateContainer();
        if (options.alwaysReplay) {
          container.alwaysReplay();
        }
        if (options.disableRetries) {
          container.disableRetries();
        }
        return container;
      };
    }
    const resolvedStartOptions: ResolvedTestEnvironmentOptions = {
      serviceEndpointAccess:
        options.serviceEndpointAccess ??
        DEFAULT_START_OPTIONS.serviceEndpointAccess,
      storage: options.storage ?? DEFAULT_START_OPTIONS.storage,
    };

    const startedRestateHttpServer = await prepareRestateEndpoint(options);
    const startedRestateContainer = await prepareRestateTestContainer(
      (startedRestateHttpServer.address() as net.AddressInfo).port,
      containerFactory,
      resolvedStartOptions
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

  /**
   * Forces restate-server to always replay on a suspension point.
   * This is useful to hunt non-deterministic bugs that might prevent
   * your code from replaying correctly.
   */
  alwaysReplay(): this {
    this.withEnvironment({
      RESTATE_WORKER__INVOKER__INACTIVITY_TIMEOUT: "0s",
    });
    return this;
  }

  /**
   * Disables retries in the restate-server invoker.
   * This is useful in tests so that failures surface immediately
   * instead of hanging through retry backoff.
   */
  disableRetries(): this {
    this.withEnvironment({
      RESTATE_DEFAULT_RETRY_POLICY__MAX_ATTEMPTS: "1",
      RESTATE_DEFAULT_RETRY_POLICY__ON_MAX_ATTEMPTS: "kill",
    });
    return this;
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
