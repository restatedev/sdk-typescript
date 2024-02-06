import * as restate from "../public_api";
import {
  LifecycleStatus,
  StatusMessage,
  WorkflowConnectedSignature,
  WorkflowExternalSignature,
  WorkflowRequest,
} from "../workflows/workflow";

/* eslint-disable no-console */

export interface Restate {
  submitWorkflow<R, T>(
    path: string,
    workflowId: string,
    params: T
  ): Promise<WorkflowClient<R, unknown>>;

  submitWorkflow<R, T, U>(
    workflowApi: restate.ServiceApi<WorkflowExternalSignature<R, T, U>>,
    workflowId: string,
    params: T
  ): Promise<WorkflowClient<R, U>>;

  connectToWorkflow<R = unknown>(
    path: string,
    workflowId: string
  ): Promise<WorkflowClient<R, unknown>>;

  connectToWorkflow<R, T, U>(
    workflowApi: restate.ServiceApi<WorkflowExternalSignature<R, T, U>>,
    workflowId: string
  ): Promise<WorkflowClient<R, U>>;
}

export interface WorkflowClient<R, U> {
  workflowId(): string;
  status(): Promise<LifecycleStatus>; // RUNNING / FINISHED / FAILED

  result(): Promise<R>;

  workflowInterface(): restate.Client<WorkflowConnectedSignature<U>>; // call methods on workflow

  latestMessage(): Promise<StatusMessage>;

  getMessages(
    fromSeqNum: number
  ): AsyncGenerator<StatusMessage, void, undefined>;
}

export function connectRestate(uri: string) {
  return new RestateImpl(uri);
}

// ------------------------------ implementation ------------------------------

class WorkflowClientImpl<R, U> implements WorkflowClient<R, U> {
  constructor(
    private readonly restateUri: string,
    private readonly serviceName: string,
    private readonly wfId: string
  ) {}

  workflowId(): string {
    return this.wfId;
  }

  status(): Promise<LifecycleStatus> {
    return this.makeCall("status", {});
  }

  result(): Promise<R> {
    return this.makeCall("waitForResult", {});
  }

  workflowInterface(): restate.Client<WorkflowConnectedSignature<U>> {
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

    return clientProxy as restate.Client<WorkflowConnectedSignature<U>>;
  }

  latestMessage(): Promise<StatusMessage> {
    return this.makeCall("getLatestMessage", {});
  }

  async *getMessages(fromSeqNum: number) {
    while (true) {
      const msgs: StatusMessage[] = await this.makeCall("pollNextMessages", {
        from: fromSeqNum,
      });
      for (const msg of msgs) {
        yield msg;
      }
      fromSeqNum += msgs.length;
    }
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

class RestateImpl implements Restate {
  constructor(private readonly restateUri: string) {}

  async submitWorkflow<R, T, U>(
    pathOrApi: string | restate.ServiceApi<WorkflowExternalSignature<R, T, U>>,
    workflowId: string,
    params: T
  ): Promise<WorkflowClient<R, U>> {
    const path = typeof pathOrApi === "string" ? pathOrApi : pathOrApi.path;
    const response = await makeCall(
      this.restateUri,
      path,
      "start",
      workflowId,
      params
    );
    console.log("Start() call completed: Workflow is " + response);

    return new WorkflowClientImpl(this.restateUri, path, workflowId);
  }

  async connectToWorkflow<R, T, U>(
    pathOrApi: string | restate.ServiceApi<WorkflowExternalSignature<R, T, U>>,
    workflowId: string
  ): Promise<WorkflowClient<R, U>> {
    const path = typeof pathOrApi === "string" ? pathOrApi : pathOrApi.path;
    return new WorkflowClientImpl(this.restateUri, path, workflowId);
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
  if (typeof workflowId !== "string" || workflowId.length === 0) {
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
    request: { workflowId, ...params } satisfies WorkflowRequest<T>,
  };

  let body: string;
  try {
    body = JSON.stringify(data);
  } catch (err) {
    throw new Error("Cannot encode request: " + err, { cause: err });
  }

  console.log(`Making call to Restate workflow at ${url} with ${body}`);

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
