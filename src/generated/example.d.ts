import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace dev. */
export namespace dev {

    /** Namespace restate. */
    namespace restate {

        /** Namespace Greeter. */
        namespace Greeter {

            /** Represents a Greeter */
            class Greeter extends $protobuf.rpc.Service {

                /**
                 * Constructs a new Greeter service.
                 * @param rpcImpl RPC implementation
                 * @param [requestDelimited=false] Whether requests are length-delimited
                 * @param [responseDelimited=false] Whether responses are length-delimited
                 */
                constructor(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean);

                /**
                 * Creates new Greeter service using the specified rpc implementation.
                 * @param rpcImpl RPC implementation
                 * @param [requestDelimited=false] Whether requests are length-delimited
                 * @param [responseDelimited=false] Whether responses are length-delimited
                 * @returns RPC service. Useful where requests and/or responses are streamed.
                 */
                public static create(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean): Greeter;

                /**
                 * Calls Greet.
                 * @param request GreetRequest message or plain object
                 * @param callback Node-style callback called with the error, if any, and GreetResponse
                 */
                public greet(request: dev.restate.Greeter.IGreetRequest, callback: dev.restate.Greeter.Greeter.GreetCallback): void;

                /**
                 * Calls Greet.
                 * @param request GreetRequest message or plain object
                 * @returns Promise
                 */
                public greet(request: dev.restate.Greeter.IGreetRequest): Promise<dev.restate.Greeter.GreetResponse>;
            }

            namespace Greeter {

                /**
                 * Callback as used by {@link dev.restate.Greeter.Greeter#greet}.
                 * @param error Error, if any
                 * @param [response] GreetResponse
                 */
                type GreetCallback = (error: (Error|null), response?: dev.restate.Greeter.GreetResponse) => void;
            }

            /** Properties of a GreetRequest. */
            interface IGreetRequest {

                /** GreetRequest name */
                name?: (string|null);
            }

            /** Represents a GreetRequest. */
            class GreetRequest implements IGreetRequest {

                /**
                 * Constructs a new GreetRequest.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: dev.restate.Greeter.IGreetRequest);

                /** GreetRequest name. */
                public name: string;

                /**
                 * Creates a new GreetRequest instance using the specified properties.
                 * @param [properties] Properties to set
                 * @returns GreetRequest instance
                 */
                public static create(properties?: dev.restate.Greeter.IGreetRequest): dev.restate.Greeter.GreetRequest;

                /**
                 * Encodes the specified GreetRequest message. Does not implicitly {@link dev.restate.Greeter.GreetRequest.verify|verify} messages.
                 * @param message GreetRequest message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: dev.restate.Greeter.IGreetRequest, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Encodes the specified GreetRequest message, length delimited. Does not implicitly {@link dev.restate.Greeter.GreetRequest.verify|verify} messages.
                 * @param message GreetRequest message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encodeDelimited(message: dev.restate.Greeter.IGreetRequest, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a GreetRequest message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns GreetRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.Greeter.GreetRequest;

                /**
                 * Decodes a GreetRequest message from the specified reader or buffer, length delimited.
                 * @param reader Reader or buffer to decode from
                 * @returns GreetRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.Greeter.GreetRequest;

                /**
                 * Verifies a GreetRequest message.
                 * @param message Plain object to verify
                 * @returns `null` if valid, otherwise the reason why it is not
                 */
                public static verify(message: { [k: string]: any }): (string|null);

                /**
                 * Creates a GreetRequest message from a plain object. Also converts values to their respective internal types.
                 * @param object Plain object
                 * @returns GreetRequest
                 */
                public static fromObject(object: { [k: string]: any }): dev.restate.Greeter.GreetRequest;

                /**
                 * Creates a plain object from a GreetRequest message. Also converts values to other types if specified.
                 * @param message GreetRequest
                 * @param [options] Conversion options
                 * @returns Plain object
                 */
                public static toObject(message: dev.restate.Greeter.GreetRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

                /**
                 * Converts this GreetRequest to JSON.
                 * @returns JSON object
                 */
                public toJSON(): { [k: string]: any };

                /**
                 * Gets the default type url for GreetRequest
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }

            /** Properties of a GreetResponse. */
            interface IGreetResponse {

                /** GreetResponse greeting */
                greeting?: (string|null);
            }

            /** Represents a GreetResponse. */
            class GreetResponse implements IGreetResponse {

                /**
                 * Constructs a new GreetResponse.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: dev.restate.Greeter.IGreetResponse);

                /** GreetResponse greeting. */
                public greeting: string;

                /**
                 * Creates a new GreetResponse instance using the specified properties.
                 * @param [properties] Properties to set
                 * @returns GreetResponse instance
                 */
                public static create(properties?: dev.restate.Greeter.IGreetResponse): dev.restate.Greeter.GreetResponse;

                /**
                 * Encodes the specified GreetResponse message. Does not implicitly {@link dev.restate.Greeter.GreetResponse.verify|verify} messages.
                 * @param message GreetResponse message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encode(message: dev.restate.Greeter.IGreetResponse, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Encodes the specified GreetResponse message, length delimited. Does not implicitly {@link dev.restate.Greeter.GreetResponse.verify|verify} messages.
                 * @param message GreetResponse message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                public static encodeDelimited(message: dev.restate.Greeter.IGreetResponse, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a GreetResponse message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns GreetResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.Greeter.GreetResponse;

                /**
                 * Decodes a GreetResponse message from the specified reader or buffer, length delimited.
                 * @param reader Reader or buffer to decode from
                 * @returns GreetResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.Greeter.GreetResponse;

                /**
                 * Verifies a GreetResponse message.
                 * @param message Plain object to verify
                 * @returns `null` if valid, otherwise the reason why it is not
                 */
                public static verify(message: { [k: string]: any }): (string|null);

                /**
                 * Creates a GreetResponse message from a plain object. Also converts values to their respective internal types.
                 * @param object Plain object
                 * @returns GreetResponse
                 */
                public static fromObject(object: { [k: string]: any }): dev.restate.Greeter.GreetResponse;

                /**
                 * Creates a plain object from a GreetResponse message. Also converts values to other types if specified.
                 * @param message GreetResponse
                 * @param [options] Conversion options
                 * @returns Plain object
                 */
                public static toObject(message: dev.restate.Greeter.GreetResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

                /**
                 * Converts this GreetResponse to JSON.
                 * @returns JSON object
                 */
                public toJSON(): { [k: string]: any };

                /**
                 * Gets the default type url for GreetResponse
                 * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns The default type url
                 */
                public static getTypeUrl(typeUrlPrefix?: string): string;
            }
        }
    }
}
