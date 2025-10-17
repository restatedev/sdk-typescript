/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/*
 * Copyright (c) 2023-2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable no-console */

import * as restate from "@restatedev/restate-sdk-clients";

import type { PaymentWorkflow } from "./workflow.js";

const WF: PaymentWorkflow = { name: "payment" };

const ingress = restate.connect({ url: "http://localhost:8080" });

async function basicUsageExample() {
  const paymentClient = ingress.workflowClient(WF, "my-workflow-key1");

  const submission = await paymentClient.workflowSubmit({
    account: "abc",
    amount: 1337,
  });

  console.log(`The workflow is submitted successfully!
  You can now follow the workflow's progress using the CLI etc',
  using the following invocation id: ${submission.invocationId}`);

  const output = await paymentClient.workflowOutput();
  if (output.ready) {
    console.log(`Cool! our workflow is ready! ${output.result}`);
  } else {
    console.log(`The workflow has not yet completed.`);
  }

  //
  // let's call another handler, shall we????!
  // (this handler will allow the workflow to advance)
  //
  await paymentClient.paymentWebhook("$$$");

  // And now we wait for the entire workflow to finish.
  // ~BUT~ let's do it a bit more interesting, let's reconnect to the currently
  // executing workflow, and 'attach' to it.
  // i.e. Wait for the workflow to finish with a result.

  const anotherPaymentClient = ingress.workflowClient(WF, "my-workflow-key1");
  const result = await anotherPaymentClient.workflowAttach();

  console.log(`success! ${result}`);
}

Promise.resolve()
  .then(() => basicUsageExample())
  .catch((e) => console.error(e));
