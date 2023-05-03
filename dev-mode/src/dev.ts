// # Restate Development Mode script
//
// This script watches the JS/TS sources of the service endpoint and reloads them together with the Restate Runtime.
//
// The script operates as follows:
// * Uses tsc-watch to implement JS/TS source watching, re-compilation and reload
// * When the service endpoint is starting, it sends a `docker restart` signal to the local docker/podman daemon
// * Waits for the restart using `docker ps`
// * Once the runtime started, sends a discovery request to rediscover the endpoint
//
// The script can be tuned with some options:
// * `PORT`: The service port (Default: `8080`)
// * `RESTATE_CONTAINER`: Modify the name of the restate container name (Default: `restate_dev`)
// * `RESTATE_META_PORT`: Port to access to the Meta Operational API (Default: 8081)
// * `RESTATE_SERVICE_HOSTNAME`: The service hostname the runtime should use when connecting to the service (Default: `localhost` for Linux, `host.docker.internal` for MacOS)
//
// Note: All the docker/podman signals are sent using the CLI tools, make sure the user running the script has the required privileges to run them.

import { TscWatchClient } from "tsc-watch";
import { exec } from "child_process";
import { setTimeout } from "timers/promises";
import { Command } from "commander";

// Missing native fetch type https://github.com/DefinitelyTyped/DefinitelyTyped/issues/60924\
// Workaround from https://github.com/microsoft/typespec/pull/1852
declare global {
  function fetch(...args: any[]): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function dockerPs(
  containerName: string
): Promise<Array<{ Names: string | Array<string> }>> {
  return new Promise((resolve, reject) => {
    exec(
      `docker ps -f "name=${containerName}" -f status=running --format=json`,
      function (error, stdout) {
        if (error != undefined) {
          reject(error);
        } else {
          resolve(JSON.parse(stdout));
        }
      }
    );
  });
}

async function restartRuntimeAndWaitRunningStatus(
  restateContainerName: string
) {
  await exec(`docker restart ${restateContainerName}`);

  console.log(
    `[restate-dev-mode] Sent restart command to container '${restateContainerName}'`
  );

  // Loop until the container is up again
  for (let tryCount = 0; tryCount < 30; tryCount++) {
    await setTimeout(500);
    const psResult = await dockerPs(restateContainerName);

    const restateContainer = psResult.find((container) => {
      if (container.Names instanceof Array) {
        return container.Names.some((n) => n === restateContainerName);
      } else {
        return container.Names == restateContainerName;
      }
    });

    if (restateContainer == undefined) {
      console.log(
        `[restate-dev-mode] Cannot find container '${restateContainerName}'`
      );
      continue;
    }
    console.log(
      `[restate-dev-mode] Container '${restateContainerName}' is up and running`
    );
    return;
  }
  throw new Error(
    "giving up on waiting for the container to be in running state"
  );
}

async function registerService(
  serviceUri: string,
  metaRestatePort: number
): Promise<number> {
  // Loop until the registration request succeeds.
  // Don't retry on failures of the request itself,
  // as most likely it is a bad contract or some other misconfiguration to fix.
  for (let tryCount = 0; tryCount < 20; tryCount++) {
    try {
      const registrationResponse = await fetch(
        `http://127.0.0.1:${metaRestatePort}/endpoint/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uri: serviceUri }),
        }
      );
      const jsonData = await registrationResponse.json();
      console.log(
        `[restate-dev-mode] Response to registration of endpoint ${serviceUri}: ${JSON.stringify(
          jsonData
        )}`
      );
      return registrationResponse.status;
    } catch (error) {
      console.log(
        `[restate-dev-mode] Error when performing the registration request`,
        error
      );
      await setTimeout(200);
    }
  }
  throw new Error(
    "giving up on waiting for the registration request to succeed"
  );
}

function startWatch(executablePath: string, options: { project: string }) {
  const tsConfigPath = options.project;

  // Retrieve other options from envs
  const restateContainerName = process.env.RESTATE_CONTAINER ?? "restate_dev";
  const metaRestatePort = parseInt(process.env.RESTATE_META_PORT ?? "8081");

  let serviceHostname = "localhost";
  if (process.env.RESTATE_SERVICE_HOSTNAME != undefined) {
    serviceHostname = process.env.RESTATE_SERVICE_HOSTNAME;
  } else if (process.platform === "darwin") {
    serviceHostname = "host.docker.internal";
  }
  const servicePort = parseInt(process.env.PORT ?? "8080");
  const serviceUri = `http://${serviceHostname}:${servicePort}`;

  // Typescript watcher client
  const client = new TscWatchClient();
  client.on("started", async () => {
    try {
      await restartRuntimeAndWaitRunningStatus(restateContainerName);
      const registrationStatus = await registerService(
        serviceUri,
        metaRestatePort
      );
      if (registrationStatus > 299) {
        throw new Error(
          `got status code ${registrationStatus} when executing service discovery`
        );
      }
    } catch (error) {
      let networkSuggestion =
        "Make sure you started the container with '--net=host' enabled";
      if (process.platform === "darwin") {
        networkSuggestion =
          "Make sure you have forwarded the ports 8081, 9090 and 9091, e.g. '-p 8081:8081 -p 9091:9091 -p 9090:9090'";
      }

      console.log(
        `[restate-dev-mode] Development mode cannot reload the service. Reason: ${error}.

Tips:
* Check the local container daemon is up and running and the user running the script has the required privileges to interact with the daemon.
* Check if the Restate container is correctly running using 'docker logs -f ${restateContainerName}'. If not, try to restart it manually or remove and re-create it with 'docker stop ${restateContainerName} && docker rm ${restateContainerName}'.
* Check the container ports can be reached. ${networkSuggestion}.
* If the registration failed, most likely it hints to a problem in the service contract. Make sure to fix it before restarting.`
      );
      client.kill();
    }
  });

  // Start watching
  client.start(
    "--noClear",
    "--project",
    tsConfigPath,
    "--onSuccess",
    `node ${executablePath}`
  );
}

// CLI command
const program = new Command();
program
  .name("restate-dev-mode")
  .argument("[exec]", "Built executable path", "./dist/app.js")
  .option("--project <path>", "tsconfig.json path", "./tsconfig.json")
  .action(startWatch);
program.parse();
