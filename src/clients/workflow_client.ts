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

import * as restate from "../public_api";
import { ensureError } from "../types/errors";

/**
 * A client to interact with running workflows.
 */
export interface WorkflowClient<R, U> {
  /**
   * Gets the ID of the workflow that this client talks to.
   */
  workflowId(): string;

  /**
   * Gets the status of the workflow, as a {@link restate.workflow.LifecycleStatus}.
   * This will take on the values "NOT_STARTED", "RUNNING", "FINISHED", "FAILED".
   */
  status(): Promise<restate.workflow.LifecycleStatus>;

  /**
   * Returns a promise completed with the result. This will resolve successfully on successful
   * termination of the workflow, and will be rejected if the workflow throws an Error.
   */
  result(): Promise<R>;

  /**
   * Gets the interface to the workflow through which all the workflow's additional methods
   * can be called.
   *
   * To get the proper typed client, use the {@link WorkflowConnection.submitWorkflow} or
   * {@link WorkflowConnection.connectToWorkflow} functions that accpet a typed ServiceApi
   * object, as in the example below.
   *
   * @example
   * In the workflow definition:
   * ```
   * const myWorkflow = restate.workflow.workflow("acme.myworkflow", { ... });
   * export const myWorkflowApi = myworkflow.api;
   * ```
   * In the client code:
   * ```
   * import { myWorkflowApi } from "../server/myWorkflow"
   * ...
   * const restate = connectWorkflows("https://restatehost:8080");
   * restate.submitWorkflow(myWorkflowApi, workflowId, args);
   * restate.connectToWorkflow(myWorkflowApi, workflowId);
   * ```
   */
  workflowInterface(): restate.Client<restate.workflow.WorkflowClientApi<U>>;
}

/**
 * A connection to Restate that let's you submit workflows or connect to workflows.
 * This is a typed client that internally makes HTTP calls to Restate to launch trigger
 * an execution of a workflow service, or to connect to an existing execution.
 */
export interface RestateClient {
  submitWorkflow<R, T>(
    path: string,
    workflowId: string,
    params: T
  ): Promise<{
    status: restate.workflow.WorkflowStartResult;
    client: WorkflowClient<R, unknown>;
  }>;

  submitWorkflow<R, T, U>(
    workflowApi: restate.ServiceApi<
      restate.workflow.WorkflowRestateRpcApi<R, T, U>
    >,
    workflowId: string,
    params: T
  ): Promise<{
    status: restate.workflow.WorkflowStartResult;
    client: WorkflowClient<R, U>;
  }>;

  connectToWorkflow<R = unknown>(
    path: string,
    workflowId: string
  ): Promise<{
    status: restate.workflow.LifecycleStatus;
    client: WorkflowClient<R, unknown>;
  }>;

  connectToWorkflow<R, T, U>(
    workflowApi: restate.ServiceApi<
      restate.workflow.WorkflowRestateRpcApi<R, T, U>
    >,
    workflowId: string
  ): Promise<{
    status: restate.workflow.LifecycleStatus;
    client: WorkflowClient<R, U>;
  }>;
}

/**
 * Creates a typed client to start and interact with workflow executions.
 * The specifiec URI must point to the Restate request endpoint (ingress).
 *
 * This function doesn't immediately verify the connection, it will not fail
 * if Restate is unreachable. Connection failures will only manifest when
 * attempting to submit or connect a specific workflow.
 */
export function connect(restateUri: string): RestateClient {
  return {
    submitWorkflow: async <R, T, U>(
      pathOrApi:
        | string
        | restate.ServiceApi<restate.workflow.WorkflowRestateRpcApi<R, T, U>>,
      workflowId: string,
      params: T
    ): Promise<{
      status: restate.workflow.WorkflowStartResult;
      client: WorkflowClient<R, U>;
    }> => {
      const path = typeof pathOrApi === "string" ? pathOrApi : pathOrApi.path;

      let result: restate.workflow.WorkflowStartResult;
      try {
        result = await makeCall(restateUri, path, "submit", workflowId, params);
      } catch (err) {
        const error = ensureError(err);
        throw new Error("Cannot start workflow: " + error.message, {
          cause: error,
        });
      }

      return {
        status: result,
        client: new WorkflowClientImpl(restateUri, path, workflowId),
      };
    },

    async connectToWorkflow<R, T, U>(
      pathOrApi:
        | string
        | restate.ServiceApi<restate.workflow.WorkflowRestateRpcApi<R, T, U>>,
      workflowId: string
    ): Promise<{
      status: restate.workflow.LifecycleStatus;
      client: WorkflowClient<R, U>;
    }> {
      const path = typeof pathOrApi === "string" ? pathOrApi : pathOrApi.path;
      const client: WorkflowClient<R, U> = new WorkflowClientImpl(
        restateUri,
        path,
        workflowId
      );
      const status = await client.status();
      if (status === restate.workflow.LifecycleStatus.NOT_STARTED) {
        throw new Error(
          "No workflow running/finished/failed with ID " + workflowId
        );
      }
      return {
        status,
        client: new WorkflowClientImpl(restateUri, path, workflowId),
      };
    },
  } satisfies RestateClient;
}

class WorkflowClientImpl<R, U> implements WorkflowClient<R, U> {
  constructor(
    private readonly restateUri: string,
    private readonly serviceName: string,
    private readonly wfId: string
  ) {}

  workflowId(): string {
    return this.wfId;
  }

  status(): Promise<restate.workflow.LifecycleStatus> {
    return this.makeCall("status", {});
  }

  result(): Promise<R> {
    return this.makeCall("waitForResult", {});
  }

  workflowInterface(): restate.Client<restate.workflow.WorkflowClientApi<U>> {
    const clientProxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          const method = prop as string;
          return async (args: unknown) => {
            return this.makeCall(method, args);
          };
        },
      }
    );

    return clientProxy as restate.Client<restate.workflow.WorkflowClientApi<U>>;
  }

  private async makeCall<RR, TT>(method: string, args: TT): Promise<RR> {
    return await makeCall(
      this.restateUri,
      this.serviceName,
      method,
      this.wfId,
      args
    );
  }
}

// ----------------------------------------------------------------------------
//                                 Utils
// ----------------------------------------------------------------------------

async function makeCall<R, T>(
  restateUri: string,
  serviceName: string,
  method: string,
  workflowId: string,
  params: T
): Promise<R> {
  if (!workflowId || typeof workflowId !== "string") {
    throw new Error("missing workflowId");
  }
  if (params === undefined) {
    params = {} as T;
  }
  if (typeof params !== "object") {
    throw new Error("invalid parameters: must be an object");
  }

  const url = `${restateUri}/${serviceName}/${method}`;
  const data = {
    request: {
      workflowId,
      ...params,
    } satisfies restate.workflow.WorkflowRequest<T>,
  };

  let body: string;
  try {
    body = JSON.stringify(data);
  } catch (err) {
    throw new Error("Cannot encode request: " + err, { cause: err });
  }

  // eslint-disable-next-line no-console
  console.debug(`Making call to Restate at ${url}`);

  const httpResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  const responseText = await httpResponse.text();
  if (!httpResponse.ok) {
    throw new Error(`Request failed: ${httpResponse.status}\n${responseText}`);
  }

  let response;
  try {
    response = JSON.parse(responseText);
  } catch (err) {
    throw new Error("Cannot parse response JSON: " + err, { cause: err });
  }

  if (response.error) {
    throw new Error(response.error);
  }
  if (response.response) {
    return response.response as R;
  }
  if (Object.keys(response).length === 0) {
    return undefined as R;
  }

  throw new Error("Unrecognized response object: " + responseText);
}
