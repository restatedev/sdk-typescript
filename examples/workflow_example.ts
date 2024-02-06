import * as restate from "../src/public_api";
import * as restate_wf from "../src/workflows/workflow";
import * as restate_clients from "../src/clients/client";
import { randomUUID } from "crypto";

/* eslint-disable no-console */

const restateIngressUrl = process.argv[2] || "http://localhost:8080";
const restateAdminUrl = process.argv[3] || "http://localhost:9070";

//
// (1) Definition of the workflow
//
const myworkflow = restate_wf.workflow("acme.myworkflow", {
  //
  // Each workflow must have exactly one run() function, which defines
  // the life cycle. This function isn't directly started, but indirectly
  // via the synthetic start() function.
  //
  run: async (ctx: restate_wf.WfContext, params: { name: string }) => {
    if (!params?.name) {
      throw new restate.TerminalError("Missing parameter 'name'");
    }

    ctx.console.log(">>>>>>>>>>> Starting workflow for " + params.name);

    // workflow state can be accessed from other methods. the state becomes
    // eventually visible, there is no linearizability for this state
    ctx.set("name", params.name);

    // to publish state in a way that other method calls can access it with
    // guarantees (await until visible), use promises
    ctx.promise<string>("name_promise").resolve(params.name);

    // to listen to signals, also use promises
    const signal = ctx.promise<string>("thesignal");
    const message = await signal.promise();

    const result = `${message} my dear ${params.name}`;
    ctx.console.log(">>>>>>>>>>> Finishing workflow with: " + result);
    return result;
  },

  //
  // Workflows may have an arbitrary number of other functions that take
  // a 'SharedWfContext' and have shared access to state and promises
  //

  signal: async (ctx: restate_wf.SharedWfContext, req: { signal: string }) => {
    ctx.promise<string>("thesignal").resolve(req.signal);
  },

  getName: async (ctx: restate_wf.SharedWfContext): Promise<string> => {
    return (await ctx.get("name")) ?? "(not yet set)";
  },

  awaitName: async (ctx: restate_wf.SharedWfContext): Promise<string> => {
    return ctx.promise<string>("name_promise").promise();
  },
});

// typed API similar to how other Restate RPC services work
const workflowApi = myworkflow.api;

const server = restate.createServer();
myworkflow.registerServices(server);
server.listen(9080);

//
// (2) Code to nteract with the workflow using an external client
//
// This submits a workflow and sends signals / queries to the workflow.
//

async function startWorkflowAndInteract(restateUrl: string) {
  const restate = restate_clients.connectRestate(restateUrl);

  const args = { name: "Restatearius" };
  const workflowId = randomUUID();

  // Option a) we can create clients either with just the workflow service path
  await restate.submitWorkflow("acme.myworkflow", workflowId, args);

  // Option b) we can supply the API signature and get a typed interface for all the methods
  // Because the submit is idempotent, this call here will effectively attach to the
  // previous workflow
  const client = await restate.submitWorkflow(workflowApi, workflowId, args);

  // check the status (should be RUNNING)
  const status = await client.status();
  console.log("Workflow status: " + status);

  // call method that reads the 'name' state
  const get_name = await client.workflowInterface().getName();
  console.log("Workflow getName() (snapshot read): " + get_name);

  // call method that awaits the 'name' promise
  const await_name = await client.workflowInterface().awaitName();
  console.log("Workflow awaitName() (promise): " + await_name);

  // send a signal
  client.workflowInterface().signal({ signal: "hey ho!" });

  // wait until everything is done
  const result = await client.result();
  console.log("Workflow result: " + result);
}

//
// (3) To make this example work end-to-end, with the external client below,
// we issue a registration here
//
registerDeployment(restateAdminUrl, 9080)
  .then(() => startWorkflowAndInteract(restateIngressUrl))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(-1);
  });

// --------------------- utils -----------------

async function registerDeployment(restateAdminAddress: string, port: number) {
  const serviceEndpoint = `http://host.docker.internal:${port}`;
  const httpResponse = await fetch(restateAdminAddress + "/deployments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uri: serviceEndpoint,
    }),
  });

  const responseText = await httpResponse.text();
  if (!httpResponse.ok) {
    throw new Error(
      `Registration failed: STATUS ${httpResponse.status} ; ${responseText}`
    );
  } else {
    return `Registration succeeded: STATUS ${httpResponse.status} ; ${responseText}`;
  }
}
