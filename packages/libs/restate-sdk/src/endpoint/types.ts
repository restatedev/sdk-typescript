import type {
  DefaultServiceOptions,
  LoggerTransport,
  ServiceDefinition,
  VirtualObjectDefinition,
  WorkflowDefinition,
  JournalValueCodec,
} from "../common_api.js";

/**
 * Options for creating an endpoint handler.
 */
export interface EndpointOptions {
  /**
   * A list of Restate services, virtual objects, or workflows that will be exposed via the endpoint.
   */
  services: Array<
    | ServiceDefinition<string, unknown>
    | VirtualObjectDefinition<string, unknown>
    | WorkflowDefinition<string, unknown>
  >;
  /**
   * Provide a list of v1 request identity public keys eg `publickeyv1_2G8dCQhArfvGpzPw5Vx2ALciR4xCLHfS5YaT93XjNxX9` to validate
   * incoming requests against, limiting requests to Restate clusters with the corresponding private keys. This public key format is
   * logged by the Restate process at startup if a request identity private key is provided.
   *
   * If this function is called, all incoming requests irrelevant of endpoint type will be expected to have
   * `x-restate-signature-scheme: v1` and `x-restate-jwt-v1: <valid jwt signed with one of these keys>`. If not called,
   *
   */
  identityKeys?: string[];
  /**
   * Default service options that will be used by all services bind to this endpoint.
   *
   * Options can be overridden on each service/handler.
   */
  defaultServiceOptions?: DefaultServiceOptions;
  /**
   * Replace the default console-based {@link LoggerTransport}
   * @example
   * Using console:
   * ```ts
   * createEndpointHandler({ logger: (meta, message, ...o) => {console.log(`${meta.level}: `, message, ...o)}})
   * ```
   * @example
   * Using winston:
   * ```ts
   * const logger = createLogger({ ... })
   * createEndpointHandler({ logger: (meta, message, ...o) => {logger.log(meta.level, {invocationId: meta.context?.invocationId}, [message, ...o].join(' '))} })
   * ```
   * @example
   * Using pino:
   * ```ts
   * const logger = pino()
   * createEndpointHandler({ logger: (meta, message, ...o) => {logger[meta.level]({invocationId: meta.context?.invocationId}, [message, ...o].join(' '))}} )
   * ```
   */
  logger?: LoggerTransport;

  /**
   * Provider for the codec to use for journal values. One codec will be instantiated globally for this endpoint.
   * Check {@link JournalValueCodec} for more details
   *
   * @experimental
   */
  journalValueCodecProvider?: () => Promise<JournalValueCodec>;
}
