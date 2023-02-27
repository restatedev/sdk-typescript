/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
"use strict";

var $protobuf = require("protobufjs/minimal");

// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.dev = (function() {

    /**
     * Namespace dev.
     * @exports dev
     * @namespace
     */
    var dev = {};

    dev.restate = (function() {

        /**
         * Namespace restate.
         * @memberof dev
         * @namespace
         */
        var restate = {};

        restate.Greeter = (function() {

            /**
             * Namespace Greeter.
             * @memberof dev.restate
             * @namespace
             */
            var Greeter = {};

            Greeter.Greeter = (function() {

                /**
                 * Constructs a new Greeter service.
                 * @memberof dev.restate.Greeter
                 * @classdesc Represents a Greeter
                 * @extends $protobuf.rpc.Service
                 * @constructor
                 * @param {$protobuf.RPCImpl} rpcImpl RPC implementation
                 * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
                 * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
                 */
                function Greeter(rpcImpl, requestDelimited, responseDelimited) {
                    $protobuf.rpc.Service.call(this, rpcImpl, requestDelimited, responseDelimited);
                }

                (Greeter.prototype = Object.create($protobuf.rpc.Service.prototype)).constructor = Greeter;

                /**
                 * Creates new Greeter service using the specified rpc implementation.
                 * @function create
                 * @memberof dev.restate.Greeter.Greeter
                 * @static
                 * @param {$protobuf.RPCImpl} rpcImpl RPC implementation
                 * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
                 * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
                 * @returns {Greeter} RPC service. Useful where requests and/or responses are streamed.
                 */
                Greeter.create = function create(rpcImpl, requestDelimited, responseDelimited) {
                    return new this(rpcImpl, requestDelimited, responseDelimited);
                };

                /**
                 * Callback as used by {@link dev.restate.Greeter.Greeter#greet}.
                 * @memberof dev.restate.Greeter.Greeter
                 * @typedef GreetCallback
                 * @type {function}
                 * @param {Error|null} error Error, if any
                 * @param {dev.restate.Greeter.GreetResponse} [response] GreetResponse
                 */

                /**
                 * Calls Greet.
                 * @function greet
                 * @memberof dev.restate.Greeter.Greeter
                 * @instance
                 * @param {dev.restate.Greeter.IGreetRequest} request GreetRequest message or plain object
                 * @param {dev.restate.Greeter.Greeter.GreetCallback} callback Node-style callback called with the error, if any, and GreetResponse
                 * @returns {undefined}
                 * @variation 1
                 */
                Object.defineProperty(Greeter.prototype.greet = function greet(request, callback) {
                    return this.rpcCall(greet, $root.dev.restate.Greeter.GreetRequest, $root.dev.restate.Greeter.GreetResponse, request, callback);
                }, "name", { value: "Greet" });

                /**
                 * Calls Greet.
                 * @function greet
                 * @memberof dev.restate.Greeter.Greeter
                 * @instance
                 * @param {dev.restate.Greeter.IGreetRequest} request GreetRequest message or plain object
                 * @returns {Promise<dev.restate.Greeter.GreetResponse>} Promise
                 * @variation 2
                 */

                return Greeter;
            })();

            Greeter.GreetRequest = (function() {

                /**
                 * Properties of a GreetRequest.
                 * @memberof dev.restate.Greeter
                 * @interface IGreetRequest
                 * @property {string|null} [name] GreetRequest name
                 */

                /**
                 * Constructs a new GreetRequest.
                 * @memberof dev.restate.Greeter
                 * @classdesc Represents a GreetRequest.
                 * @implements IGreetRequest
                 * @constructor
                 * @param {dev.restate.Greeter.IGreetRequest=} [properties] Properties to set
                 */
                function GreetRequest(properties) {
                    if (properties)
                        for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * GreetRequest name.
                 * @member {string} name
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @instance
                 */
                GreetRequest.prototype.name = "";

                /**
                 * Creates a new GreetRequest instance using the specified properties.
                 * @function create
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {dev.restate.Greeter.IGreetRequest=} [properties] Properties to set
                 * @returns {dev.restate.Greeter.GreetRequest} GreetRequest instance
                 */
                GreetRequest.create = function create(properties) {
                    return new GreetRequest(properties);
                };

                /**
                 * Encodes the specified GreetRequest message. Does not implicitly {@link dev.restate.Greeter.GreetRequest.verify|verify} messages.
                 * @function encode
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {dev.restate.Greeter.IGreetRequest} message GreetRequest message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                GreetRequest.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.name);
                    return writer;
                };

                /**
                 * Encodes the specified GreetRequest message, length delimited. Does not implicitly {@link dev.restate.Greeter.GreetRequest.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {dev.restate.Greeter.IGreetRequest} message GreetRequest message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                GreetRequest.encodeDelimited = function encodeDelimited(message, writer) {
                    return this.encode(message, writer).ldelim();
                };

                /**
                 * Decodes a GreetRequest message from the specified reader or buffer.
                 * @function decode
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {dev.restate.Greeter.GreetRequest} GreetRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                GreetRequest.decode = function decode(reader, length) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.Greeter.GreetRequest();
                    while (reader.pos < end) {
                        var tag = reader.uint32();
                        switch (tag >>> 3) {
                        case 1: {
                                message.name = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Decodes a GreetRequest message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {dev.restate.Greeter.GreetRequest} GreetRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                GreetRequest.decodeDelimited = function decodeDelimited(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a GreetRequest message.
                 * @function verify
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                GreetRequest.verify = function verify(message) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (message.name != null && message.hasOwnProperty("name"))
                        if (!$util.isString(message.name))
                            return "name: string expected";
                    return null;
                };

                /**
                 * Creates a GreetRequest message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {dev.restate.Greeter.GreetRequest} GreetRequest
                 */
                GreetRequest.fromObject = function fromObject(object) {
                    if (object instanceof $root.dev.restate.Greeter.GreetRequest)
                        return object;
                    var message = new $root.dev.restate.Greeter.GreetRequest();
                    if (object.name != null)
                        message.name = String(object.name);
                    return message;
                };

                /**
                 * Creates a plain object from a GreetRequest message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {dev.restate.Greeter.GreetRequest} message GreetRequest
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                GreetRequest.toObject = function toObject(message, options) {
                    if (!options)
                        options = {};
                    var object = {};
                    if (options.defaults)
                        object.name = "";
                    if (message.name != null && message.hasOwnProperty("name"))
                        object.name = message.name;
                    return object;
                };

                /**
                 * Converts this GreetRequest to JSON.
                 * @function toJSON
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                GreetRequest.prototype.toJSON = function toJSON() {
                    return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the default type url for GreetRequest
                 * @function getTypeUrl
                 * @memberof dev.restate.Greeter.GreetRequest
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                GreetRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/dev.restate.Greeter.GreetRequest";
                };

                return GreetRequest;
            })();

            Greeter.GreetResponse = (function() {

                /**
                 * Properties of a GreetResponse.
                 * @memberof dev.restate.Greeter
                 * @interface IGreetResponse
                 * @property {string|null} [greeting] GreetResponse greeting
                 */

                /**
                 * Constructs a new GreetResponse.
                 * @memberof dev.restate.Greeter
                 * @classdesc Represents a GreetResponse.
                 * @implements IGreetResponse
                 * @constructor
                 * @param {dev.restate.Greeter.IGreetResponse=} [properties] Properties to set
                 */
                function GreetResponse(properties) {
                    if (properties)
                        for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null)
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * GreetResponse greeting.
                 * @member {string} greeting
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @instance
                 */
                GreetResponse.prototype.greeting = "";

                /**
                 * Creates a new GreetResponse instance using the specified properties.
                 * @function create
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {dev.restate.Greeter.IGreetResponse=} [properties] Properties to set
                 * @returns {dev.restate.Greeter.GreetResponse} GreetResponse instance
                 */
                GreetResponse.create = function create(properties) {
                    return new GreetResponse(properties);
                };

                /**
                 * Encodes the specified GreetResponse message. Does not implicitly {@link dev.restate.Greeter.GreetResponse.verify|verify} messages.
                 * @function encode
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {dev.restate.Greeter.IGreetResponse} message GreetResponse message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                GreetResponse.encode = function encode(message, writer) {
                    if (!writer)
                        writer = $Writer.create();
                    if (message.greeting != null && Object.hasOwnProperty.call(message, "greeting"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.greeting);
                    return writer;
                };

                /**
                 * Encodes the specified GreetResponse message, length delimited. Does not implicitly {@link dev.restate.Greeter.GreetResponse.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {dev.restate.Greeter.IGreetResponse} message GreetResponse message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                GreetResponse.encodeDelimited = function encodeDelimited(message, writer) {
                    return this.encode(message, writer).ldelim();
                };

                /**
                 * Decodes a GreetResponse message from the specified reader or buffer.
                 * @function decode
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {dev.restate.Greeter.GreetResponse} GreetResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                GreetResponse.decode = function decode(reader, length) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.Greeter.GreetResponse();
                    while (reader.pos < end) {
                        var tag = reader.uint32();
                        switch (tag >>> 3) {
                        case 1: {
                                message.greeting = reader.string();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Decodes a GreetResponse message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {dev.restate.Greeter.GreetResponse} GreetResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                GreetResponse.decodeDelimited = function decodeDelimited(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a GreetResponse message.
                 * @function verify
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                GreetResponse.verify = function verify(message) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (message.greeting != null && message.hasOwnProperty("greeting"))
                        if (!$util.isString(message.greeting))
                            return "greeting: string expected";
                    return null;
                };

                /**
                 * Creates a GreetResponse message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {dev.restate.Greeter.GreetResponse} GreetResponse
                 */
                GreetResponse.fromObject = function fromObject(object) {
                    if (object instanceof $root.dev.restate.Greeter.GreetResponse)
                        return object;
                    var message = new $root.dev.restate.Greeter.GreetResponse();
                    if (object.greeting != null)
                        message.greeting = String(object.greeting);
                    return message;
                };

                /**
                 * Creates a plain object from a GreetResponse message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {dev.restate.Greeter.GreetResponse} message GreetResponse
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                GreetResponse.toObject = function toObject(message, options) {
                    if (!options)
                        options = {};
                    var object = {};
                    if (options.defaults)
                        object.greeting = "";
                    if (message.greeting != null && message.hasOwnProperty("greeting"))
                        object.greeting = message.greeting;
                    return object;
                };

                /**
                 * Converts this GreetResponse to JSON.
                 * @function toJSON
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                GreetResponse.prototype.toJSON = function toJSON() {
                    return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the default type url for GreetResponse
                 * @function getTypeUrl
                 * @memberof dev.restate.Greeter.GreetResponse
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                GreetResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/dev.restate.Greeter.GreetResponse";
                };

                return GreetResponse;
            })();

            return Greeter;
        })();

        return restate;
    })();

    return dev;
})();

module.exports = $root;
