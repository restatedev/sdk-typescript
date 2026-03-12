import type { RestateResponse } from "./types.js";
import type { Endpoint } from "../endpoint.js";
import type {
  Endpoint as EndpointManifest,
  ProtocolMode,
} from "../discovery.js";
import { X_RESTATE_SERVER } from "../../user_agent.js";
import { errorResponse, simpleResponse } from "./utils.js";

const ENDPOINT_MANIFEST_V2 = "application/vnd.restate.endpointmanifest.v2+json";
const ENDPOINT_MANIFEST_V3 = "application/vnd.restate.endpointmanifest.v3+json";
const ENDPOINT_MANIFEST_V4 = "application/vnd.restate.endpointmanifest.v4+json";

export function handleDiscovery(
  endpoint: Endpoint,
  protocolMode: ProtocolMode,
  additionalDiscoveryFields: Partial<EndpointManifest>,
  acceptVersionsString: string | string[] | undefined
): RestateResponse {
  if (typeof acceptVersionsString !== "string") {
    const errorMessage = "Missing accept header";
    endpoint.rlog.warn(errorMessage);
    return errorResponse(415, errorMessage);
  }

  // Negotiate version to use
  let manifestVersion;
  if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V4)) {
    manifestVersion = 4;
  } else if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V3)) {
    manifestVersion = 3;
  } else if (acceptVersionsString.includes(ENDPOINT_MANIFEST_V2)) {
    manifestVersion = 2;
  } else {
    const errorMessage = `Unsupported service discovery protocol version '${acceptVersionsString}'`;
    endpoint.rlog.warn(errorMessage);
    return errorResponse(415, errorMessage);
  }

  const discovery = {
    ...endpoint.discoveryMetadata,
    ...additionalDiscoveryFields,
    protocolMode: protocolMode,
  };

  const checkUnsupportedFeature = <T extends object>(
    obj: T,
    ...fields: Array<keyof T>
  ) => {
    for (const field of fields) {
      if (field in obj && obj[field] !== undefined) {
        return errorResponse(
          500,
          `The code uses the new discovery feature '${String(
            field
          )}' but the runtime doesn't support it yet (discovery protocol negotiated version ${manifestVersion}). Either remove the usage of this feature, or upgrade the runtime.`
        );
      }
    }
    return;
  };

  // Verify none of the manifest v3 configuration options are used.
  if (manifestVersion < 3) {
    for (const service of discovery.services) {
      const error = checkUnsupportedFeature(
        service,
        "journalRetention",
        "idempotencyRetention",
        "inactivityTimeout",
        "abortTimeout",
        "enableLazyState",
        "ingressPrivate"
      );
      if (error !== undefined) {
        return error;
      }
      for (const handler of service.handlers) {
        const error = checkUnsupportedFeature(
          handler,
          "journalRetention",
          "idempotencyRetention",
          "workflowCompletionRetention",
          "inactivityTimeout",
          "abortTimeout",
          "enableLazyState",
          "ingressPrivate"
        );
        if (error !== undefined) {
          return error;
        }
      }
    }
  }

  if (manifestVersion < 4) {
    // Blank the lambda compression field. No need to fail in this case.
    discovery.lambdaCompression = undefined;
    for (const service of discovery.services) {
      const error = checkUnsupportedFeature(
        service,
        "retryPolicyExponentiationFactor",
        "retryPolicyInitialInterval",
        "retryPolicyMaxAttempts",
        "retryPolicyMaxInterval",
        "retryPolicyOnMaxAttempts"
      );
      if (error !== undefined) {
        return error;
      }
      for (const handler of service.handlers) {
        const error = checkUnsupportedFeature(
          handler,
          "retryPolicyExponentiationFactor",
          "retryPolicyInitialInterval",
          "retryPolicyMaxAttempts",
          "retryPolicyMaxInterval",
          "retryPolicyOnMaxAttempts"
        );
        if (error !== undefined) {
          return error;
        }
      }
    }
  }

  const body = JSON.stringify(discovery);
  return simpleResponse(
    200,
    {
      "content-type":
        manifestVersion === 2
          ? ENDPOINT_MANIFEST_V2
          : manifestVersion === 3
            ? ENDPOINT_MANIFEST_V3
            : ENDPOINT_MANIFEST_V4,
      "x-restate-server": X_RESTATE_SERVER,
    },
    new TextEncoder().encode(body)
  );
}
