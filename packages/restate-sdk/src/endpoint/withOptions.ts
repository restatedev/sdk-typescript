import type { RestateEndpointBase } from "../endpoint.js";
import type { EndpointOptions } from "./types.js";

export function withOptions<E extends RestateEndpointBase<E>>(
  endpoint: E,
  {
    identityKeys,
    defaultServiceOptions,
    logger,
    services,
    defaultJournalEntryCodec,
  }: EndpointOptions
): E {
  let endpointWithOptions = endpoint;
  if (identityKeys && identityKeys.length > 0) {
    endpointWithOptions = endpointWithOptions.withIdentityV1(...identityKeys);
  }
  if (defaultServiceOptions) {
    endpointWithOptions = endpointWithOptions.defaultServiceOptions(
      defaultServiceOptions
    );
  }
  if (defaultJournalEntryCodec) {
    endpointWithOptions = endpointWithOptions.defaultJournalEntryCodec(
      defaultJournalEntryCodec
    );
  }
  if (logger) {
    endpointWithOptions = endpointWithOptions.setLogger(logger);
  }

  return services.reduce((results, service) => {
    return results.bind(service);
  }, endpointWithOptions);
}
