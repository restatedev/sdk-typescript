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

        restate.service = (function() {

            /**
             * Namespace service.
             * @memberof dev.restate
             * @namespace
             */
            var service = {};

            service.protocol = (function() {

                /**
                 * Namespace protocol.
                 * @memberof dev.restate.service
                 * @namespace
                 */
                var protocol = {};

                protocol.StartMessage = (function() {

                    /**
                     * Properties of a StartMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IStartMessage
                     * @property {Uint8Array|null} [invocationId] StartMessage invocationId
                     * @property {Uint8Array|null} [instanceKey] StartMessage instanceKey
                     * @property {number|null} [knownServiceVersion] StartMessage knownServiceVersion
                     * @property {number|null} [knownEntries] StartMessage knownEntries
                     */

                    /**
                     * Constructs a new StartMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a StartMessage.
                     * @implements IStartMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IStartMessage=} [properties] Properties to set
                     */
                    function StartMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * StartMessage invocationId.
                     * @member {Uint8Array} invocationId
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @instance
                     */
                    StartMessage.prototype.invocationId = $util.newBuffer([]);

                    /**
                     * StartMessage instanceKey.
                     * @member {Uint8Array} instanceKey
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @instance
                     */
                    StartMessage.prototype.instanceKey = $util.newBuffer([]);

                    /**
                     * StartMessage knownServiceVersion.
                     * @member {number} knownServiceVersion
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @instance
                     */
                    StartMessage.prototype.knownServiceVersion = 0;

                    /**
                     * StartMessage knownEntries.
                     * @member {number} knownEntries
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @instance
                     */
                    StartMessage.prototype.knownEntries = 0;

                    /**
                     * Creates a new StartMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {dev.restate.service.protocol.IStartMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.StartMessage} StartMessage instance
                     */
                    StartMessage.create = function create(properties) {
                        return new StartMessage(properties);
                    };

                    /**
                     * Encodes the specified StartMessage message. Does not implicitly {@link dev.restate.service.protocol.StartMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {dev.restate.service.protocol.IStartMessage} message StartMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    StartMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.invocationId != null && Object.hasOwnProperty.call(message, "invocationId"))
                            writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.invocationId);
                        if (message.instanceKey != null && Object.hasOwnProperty.call(message, "instanceKey"))
                            writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.instanceKey);
                        if (message.knownServiceVersion != null && Object.hasOwnProperty.call(message, "knownServiceVersion"))
                            writer.uint32(/* id 3, wireType 0 =*/24).uint32(message.knownServiceVersion);
                        if (message.knownEntries != null && Object.hasOwnProperty.call(message, "knownEntries"))
                            writer.uint32(/* id 4, wireType 0 =*/32).uint32(message.knownEntries);
                        return writer;
                    };

                    /**
                     * Encodes the specified StartMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.StartMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {dev.restate.service.protocol.IStartMessage} message StartMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    StartMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a StartMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.StartMessage} StartMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    StartMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.StartMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.invocationId = reader.bytes();
                                    break;
                                }
                            case 2: {
                                    message.instanceKey = reader.bytes();
                                    break;
                                }
                            case 3: {
                                    message.knownServiceVersion = reader.uint32();
                                    break;
                                }
                            case 4: {
                                    message.knownEntries = reader.uint32();
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
                     * Decodes a StartMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.StartMessage} StartMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    StartMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a StartMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    StartMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.invocationId != null && message.hasOwnProperty("invocationId"))
                            if (!(message.invocationId && typeof message.invocationId.length === "number" || $util.isString(message.invocationId)))
                                return "invocationId: buffer expected";
                        if (message.instanceKey != null && message.hasOwnProperty("instanceKey"))
                            if (!(message.instanceKey && typeof message.instanceKey.length === "number" || $util.isString(message.instanceKey)))
                                return "instanceKey: buffer expected";
                        if (message.knownServiceVersion != null && message.hasOwnProperty("knownServiceVersion"))
                            if (!$util.isInteger(message.knownServiceVersion))
                                return "knownServiceVersion: integer expected";
                        if (message.knownEntries != null && message.hasOwnProperty("knownEntries"))
                            if (!$util.isInteger(message.knownEntries))
                                return "knownEntries: integer expected";
                        return null;
                    };

                    /**
                     * Creates a StartMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.StartMessage} StartMessage
                     */
                    StartMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.StartMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.StartMessage();
                        if (object.invocationId != null)
                            if (typeof object.invocationId === "string")
                                $util.base64.decode(object.invocationId, message.invocationId = $util.newBuffer($util.base64.length(object.invocationId)), 0);
                            else if (object.invocationId.length >= 0)
                                message.invocationId = object.invocationId;
                        if (object.instanceKey != null)
                            if (typeof object.instanceKey === "string")
                                $util.base64.decode(object.instanceKey, message.instanceKey = $util.newBuffer($util.base64.length(object.instanceKey)), 0);
                            else if (object.instanceKey.length >= 0)
                                message.instanceKey = object.instanceKey;
                        if (object.knownServiceVersion != null)
                            message.knownServiceVersion = object.knownServiceVersion >>> 0;
                        if (object.knownEntries != null)
                            message.knownEntries = object.knownEntries >>> 0;
                        return message;
                    };

                    /**
                     * Creates a plain object from a StartMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {dev.restate.service.protocol.StartMessage} message StartMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    StartMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            if (options.bytes === String)
                                object.invocationId = "";
                            else {
                                object.invocationId = [];
                                if (options.bytes !== Array)
                                    object.invocationId = $util.newBuffer(object.invocationId);
                            }
                            if (options.bytes === String)
                                object.instanceKey = "";
                            else {
                                object.instanceKey = [];
                                if (options.bytes !== Array)
                                    object.instanceKey = $util.newBuffer(object.instanceKey);
                            }
                            object.knownServiceVersion = 0;
                            object.knownEntries = 0;
                        }
                        if (message.invocationId != null && message.hasOwnProperty("invocationId"))
                            object.invocationId = options.bytes === String ? $util.base64.encode(message.invocationId, 0, message.invocationId.length) : options.bytes === Array ? Array.prototype.slice.call(message.invocationId) : message.invocationId;
                        if (message.instanceKey != null && message.hasOwnProperty("instanceKey"))
                            object.instanceKey = options.bytes === String ? $util.base64.encode(message.instanceKey, 0, message.instanceKey.length) : options.bytes === Array ? Array.prototype.slice.call(message.instanceKey) : message.instanceKey;
                        if (message.knownServiceVersion != null && message.hasOwnProperty("knownServiceVersion"))
                            object.knownServiceVersion = message.knownServiceVersion;
                        if (message.knownEntries != null && message.hasOwnProperty("knownEntries"))
                            object.knownEntries = message.knownEntries;
                        return object;
                    };

                    /**
                     * Converts this StartMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    StartMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for StartMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.StartMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    StartMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.StartMessage";
                    };

                    return StartMessage;
                })();

                protocol.CompletionMessage = (function() {

                    /**
                     * Properties of a CompletionMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface ICompletionMessage
                     * @property {number|null} [entryIndex] CompletionMessage entryIndex
                     * @property {google.protobuf.IEmpty|null} [empty] CompletionMessage empty
                     * @property {Uint8Array|null} [value] CompletionMessage value
                     * @property {dev.restate.service.protocol.IFailure|null} [failure] CompletionMessage failure
                     */

                    /**
                     * Constructs a new CompletionMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a CompletionMessage.
                     * @implements ICompletionMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.ICompletionMessage=} [properties] Properties to set
                     */
                    function CompletionMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * CompletionMessage entryIndex.
                     * @member {number} entryIndex
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     */
                    CompletionMessage.prototype.entryIndex = 0;

                    /**
                     * CompletionMessage empty.
                     * @member {google.protobuf.IEmpty|null|undefined} empty
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     */
                    CompletionMessage.prototype.empty = null;

                    /**
                     * CompletionMessage value.
                     * @member {Uint8Array|null|undefined} value
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     */
                    CompletionMessage.prototype.value = null;

                    /**
                     * CompletionMessage failure.
                     * @member {dev.restate.service.protocol.IFailure|null|undefined} failure
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     */
                    CompletionMessage.prototype.failure = null;

                    // OneOf field names bound to virtual getters and setters
                    var $oneOfFields;

                    /**
                     * CompletionMessage result.
                     * @member {"empty"|"value"|"failure"|undefined} result
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     */
                    Object.defineProperty(CompletionMessage.prototype, "result", {
                        get: $util.oneOfGetter($oneOfFields = ["empty", "value", "failure"]),
                        set: $util.oneOfSetter($oneOfFields)
                    });

                    /**
                     * Creates a new CompletionMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompletionMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.CompletionMessage} CompletionMessage instance
                     */
                    CompletionMessage.create = function create(properties) {
                        return new CompletionMessage(properties);
                    };

                    /**
                     * Encodes the specified CompletionMessage message. Does not implicitly {@link dev.restate.service.protocol.CompletionMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompletionMessage} message CompletionMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    CompletionMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.entryIndex != null && Object.hasOwnProperty.call(message, "entryIndex"))
                            writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.entryIndex);
                        if (message.empty != null && Object.hasOwnProperty.call(message, "empty"))
                            $root.google.protobuf.Empty.encode(message.empty, writer.uint32(/* id 13, wireType 2 =*/106).fork()).ldelim();
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        if (message.failure != null && Object.hasOwnProperty.call(message, "failure"))
                            $root.dev.restate.service.protocol.Failure.encode(message.failure, writer.uint32(/* id 15, wireType 2 =*/122).fork()).ldelim();
                        return writer;
                    };

                    /**
                     * Encodes the specified CompletionMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.CompletionMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompletionMessage} message CompletionMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    CompletionMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a CompletionMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.CompletionMessage} CompletionMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    CompletionMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.CompletionMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.entryIndex = reader.uint32();
                                    break;
                                }
                            case 13: {
                                    message.empty = $root.google.protobuf.Empty.decode(reader, reader.uint32());
                                    break;
                                }
                            case 14: {
                                    message.value = reader.bytes();
                                    break;
                                }
                            case 15: {
                                    message.failure = $root.dev.restate.service.protocol.Failure.decode(reader, reader.uint32());
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
                     * Decodes a CompletionMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.CompletionMessage} CompletionMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    CompletionMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a CompletionMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    CompletionMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        var properties = {};
                        if (message.entryIndex != null && message.hasOwnProperty("entryIndex"))
                            if (!$util.isInteger(message.entryIndex))
                                return "entryIndex: integer expected";
                        if (message.empty != null && message.hasOwnProperty("empty")) {
                            properties.result = 1;
                            {
                                var error = $root.google.protobuf.Empty.verify(message.empty);
                                if (error)
                                    return "empty." + error;
                            }
                        }
                        if (message.value != null && message.hasOwnProperty("value")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            {
                                var error = $root.dev.restate.service.protocol.Failure.verify(message.failure);
                                if (error)
                                    return "failure." + error;
                            }
                        }
                        return null;
                    };

                    /**
                     * Creates a CompletionMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.CompletionMessage} CompletionMessage
                     */
                    CompletionMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.CompletionMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.CompletionMessage();
                        if (object.entryIndex != null)
                            message.entryIndex = object.entryIndex >>> 0;
                        if (object.empty != null) {
                            if (typeof object.empty !== "object")
                                throw TypeError(".dev.restate.service.protocol.CompletionMessage.empty: object expected");
                            message.empty = $root.google.protobuf.Empty.fromObject(object.empty);
                        }
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        if (object.failure != null) {
                            if (typeof object.failure !== "object")
                                throw TypeError(".dev.restate.service.protocol.CompletionMessage.failure: object expected");
                            message.failure = $root.dev.restate.service.protocol.Failure.fromObject(object.failure);
                        }
                        return message;
                    };

                    /**
                     * Creates a plain object from a CompletionMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {dev.restate.service.protocol.CompletionMessage} message CompletionMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    CompletionMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults)
                            object.entryIndex = 0;
                        if (message.entryIndex != null && message.hasOwnProperty("entryIndex"))
                            object.entryIndex = message.entryIndex;
                        if (message.empty != null && message.hasOwnProperty("empty")) {
                            object.empty = $root.google.protobuf.Empty.toObject(message.empty, options);
                            if (options.oneofs)
                                object.result = "empty";
                        }
                        if (message.value != null && message.hasOwnProperty("value")) {
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                            if (options.oneofs)
                                object.result = "value";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            object.failure = $root.dev.restate.service.protocol.Failure.toObject(message.failure, options);
                            if (options.oneofs)
                                object.result = "failure";
                        }
                        return object;
                    };

                    /**
                     * Converts this CompletionMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    CompletionMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for CompletionMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.CompletionMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    CompletionMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.CompletionMessage";
                    };

                    return CompletionMessage;
                })();

                protocol.PollInputStreamEntryMessage = (function() {

                    /**
                     * Properties of a PollInputStreamEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IPollInputStreamEntryMessage
                     * @property {Uint8Array|null} [value] PollInputStreamEntryMessage value
                     */

                    /**
                     * Constructs a new PollInputStreamEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a PollInputStreamEntryMessage.
                     * @implements IPollInputStreamEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IPollInputStreamEntryMessage=} [properties] Properties to set
                     */
                    function PollInputStreamEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * PollInputStreamEntryMessage value.
                     * @member {Uint8Array} value
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @instance
                     */
                    PollInputStreamEntryMessage.prototype.value = $util.newBuffer([]);

                    /**
                     * Creates a new PollInputStreamEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IPollInputStreamEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.PollInputStreamEntryMessage} PollInputStreamEntryMessage instance
                     */
                    PollInputStreamEntryMessage.create = function create(properties) {
                        return new PollInputStreamEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified PollInputStreamEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.PollInputStreamEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IPollInputStreamEntryMessage} message PollInputStreamEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    PollInputStreamEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        return writer;
                    };

                    /**
                     * Encodes the specified PollInputStreamEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.PollInputStreamEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IPollInputStreamEntryMessage} message PollInputStreamEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    PollInputStreamEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a PollInputStreamEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.PollInputStreamEntryMessage} PollInputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    PollInputStreamEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.PollInputStreamEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 14: {
                                    message.value = reader.bytes();
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
                     * Decodes a PollInputStreamEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.PollInputStreamEntryMessage} PollInputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    PollInputStreamEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a PollInputStreamEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    PollInputStreamEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.value != null && message.hasOwnProperty("value"))
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        return null;
                    };

                    /**
                     * Creates a PollInputStreamEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.PollInputStreamEntryMessage} PollInputStreamEntryMessage
                     */
                    PollInputStreamEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.PollInputStreamEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.PollInputStreamEntryMessage();
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        return message;
                    };

                    /**
                     * Creates a plain object from a PollInputStreamEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.PollInputStreamEntryMessage} message PollInputStreamEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    PollInputStreamEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults)
                            if (options.bytes === String)
                                object.value = "";
                            else {
                                object.value = [];
                                if (options.bytes !== Array)
                                    object.value = $util.newBuffer(object.value);
                            }
                        if (message.value != null && message.hasOwnProperty("value"))
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                        return object;
                    };

                    /**
                     * Converts this PollInputStreamEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    PollInputStreamEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for PollInputStreamEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.PollInputStreamEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    PollInputStreamEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.PollInputStreamEntryMessage";
                    };

                    return PollInputStreamEntryMessage;
                })();

                protocol.OutputStreamEntryMessage = (function() {

                    /**
                     * Properties of an OutputStreamEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IOutputStreamEntryMessage
                     * @property {Uint8Array|null} [value] OutputStreamEntryMessage value
                     * @property {dev.restate.service.protocol.IFailure|null} [failure] OutputStreamEntryMessage failure
                     */

                    /**
                     * Constructs a new OutputStreamEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents an OutputStreamEntryMessage.
                     * @implements IOutputStreamEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IOutputStreamEntryMessage=} [properties] Properties to set
                     */
                    function OutputStreamEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * OutputStreamEntryMessage value.
                     * @member {Uint8Array|null|undefined} value
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @instance
                     */
                    OutputStreamEntryMessage.prototype.value = null;

                    /**
                     * OutputStreamEntryMessage failure.
                     * @member {dev.restate.service.protocol.IFailure|null|undefined} failure
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @instance
                     */
                    OutputStreamEntryMessage.prototype.failure = null;

                    // OneOf field names bound to virtual getters and setters
                    var $oneOfFields;

                    /**
                     * OutputStreamEntryMessage result.
                     * @member {"value"|"failure"|undefined} result
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @instance
                     */
                    Object.defineProperty(OutputStreamEntryMessage.prototype, "result", {
                        get: $util.oneOfGetter($oneOfFields = ["value", "failure"]),
                        set: $util.oneOfSetter($oneOfFields)
                    });

                    /**
                     * Creates a new OutputStreamEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IOutputStreamEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.OutputStreamEntryMessage} OutputStreamEntryMessage instance
                     */
                    OutputStreamEntryMessage.create = function create(properties) {
                        return new OutputStreamEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified OutputStreamEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.OutputStreamEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IOutputStreamEntryMessage} message OutputStreamEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    OutputStreamEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        if (message.failure != null && Object.hasOwnProperty.call(message, "failure"))
                            $root.dev.restate.service.protocol.Failure.encode(message.failure, writer.uint32(/* id 15, wireType 2 =*/122).fork()).ldelim();
                        return writer;
                    };

                    /**
                     * Encodes the specified OutputStreamEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.OutputStreamEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IOutputStreamEntryMessage} message OutputStreamEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    OutputStreamEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes an OutputStreamEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.OutputStreamEntryMessage} OutputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    OutputStreamEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.OutputStreamEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 14: {
                                    message.value = reader.bytes();
                                    break;
                                }
                            case 15: {
                                    message.failure = $root.dev.restate.service.protocol.Failure.decode(reader, reader.uint32());
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
                     * Decodes an OutputStreamEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.OutputStreamEntryMessage} OutputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    OutputStreamEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies an OutputStreamEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    OutputStreamEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        var properties = {};
                        if (message.value != null && message.hasOwnProperty("value")) {
                            properties.result = 1;
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            {
                                var error = $root.dev.restate.service.protocol.Failure.verify(message.failure);
                                if (error)
                                    return "failure." + error;
                            }
                        }
                        return null;
                    };

                    /**
                     * Creates an OutputStreamEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.OutputStreamEntryMessage} OutputStreamEntryMessage
                     */
                    OutputStreamEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.OutputStreamEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.OutputStreamEntryMessage();
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        if (object.failure != null) {
                            if (typeof object.failure !== "object")
                                throw TypeError(".dev.restate.service.protocol.OutputStreamEntryMessage.failure: object expected");
                            message.failure = $root.dev.restate.service.protocol.Failure.fromObject(object.failure);
                        }
                        return message;
                    };

                    /**
                     * Creates a plain object from an OutputStreamEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.OutputStreamEntryMessage} message OutputStreamEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    OutputStreamEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (message.value != null && message.hasOwnProperty("value")) {
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                            if (options.oneofs)
                                object.result = "value";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            object.failure = $root.dev.restate.service.protocol.Failure.toObject(message.failure, options);
                            if (options.oneofs)
                                object.result = "failure";
                        }
                        return object;
                    };

                    /**
                     * Converts this OutputStreamEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    OutputStreamEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for OutputStreamEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.OutputStreamEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    OutputStreamEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.OutputStreamEntryMessage";
                    };

                    return OutputStreamEntryMessage;
                })();

                protocol.GetStateEntryMessage = (function() {

                    /**
                     * Properties of a GetStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IGetStateEntryMessage
                     * @property {Uint8Array|null} [key] GetStateEntryMessage key
                     * @property {google.protobuf.IEmpty|null} [empty] GetStateEntryMessage empty
                     * @property {Uint8Array|null} [value] GetStateEntryMessage value
                     */

                    /**
                     * Constructs a new GetStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a GetStateEntryMessage.
                     * @implements IGetStateEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IGetStateEntryMessage=} [properties] Properties to set
                     */
                    function GetStateEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * GetStateEntryMessage key.
                     * @member {Uint8Array} key
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @instance
                     */
                    GetStateEntryMessage.prototype.key = $util.newBuffer([]);

                    /**
                     * GetStateEntryMessage empty.
                     * @member {google.protobuf.IEmpty|null|undefined} empty
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @instance
                     */
                    GetStateEntryMessage.prototype.empty = null;

                    /**
                     * GetStateEntryMessage value.
                     * @member {Uint8Array|null|undefined} value
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @instance
                     */
                    GetStateEntryMessage.prototype.value = null;

                    // OneOf field names bound to virtual getters and setters
                    var $oneOfFields;

                    /**
                     * GetStateEntryMessage result.
                     * @member {"empty"|"value"|undefined} result
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @instance
                     */
                    Object.defineProperty(GetStateEntryMessage.prototype, "result", {
                        get: $util.oneOfGetter($oneOfFields = ["empty", "value"]),
                        set: $util.oneOfSetter($oneOfFields)
                    });

                    /**
                     * Creates a new GetStateEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IGetStateEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.GetStateEntryMessage} GetStateEntryMessage instance
                     */
                    GetStateEntryMessage.create = function create(properties) {
                        return new GetStateEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified GetStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.GetStateEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IGetStateEntryMessage} message GetStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    GetStateEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.key != null && Object.hasOwnProperty.call(message, "key"))
                            writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.key);
                        if (message.empty != null && Object.hasOwnProperty.call(message, "empty"))
                            $root.google.protobuf.Empty.encode(message.empty, writer.uint32(/* id 13, wireType 2 =*/106).fork()).ldelim();
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        return writer;
                    };

                    /**
                     * Encodes the specified GetStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.GetStateEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IGetStateEntryMessage} message GetStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    GetStateEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a GetStateEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.GetStateEntryMessage} GetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    GetStateEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.GetStateEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.key = reader.bytes();
                                    break;
                                }
                            case 13: {
                                    message.empty = $root.google.protobuf.Empty.decode(reader, reader.uint32());
                                    break;
                                }
                            case 14: {
                                    message.value = reader.bytes();
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
                     * Decodes a GetStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.GetStateEntryMessage} GetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    GetStateEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a GetStateEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    GetStateEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        var properties = {};
                        if (message.key != null && message.hasOwnProperty("key"))
                            if (!(message.key && typeof message.key.length === "number" || $util.isString(message.key)))
                                return "key: buffer expected";
                        if (message.empty != null && message.hasOwnProperty("empty")) {
                            properties.result = 1;
                            {
                                var error = $root.google.protobuf.Empty.verify(message.empty);
                                if (error)
                                    return "empty." + error;
                            }
                        }
                        if (message.value != null && message.hasOwnProperty("value")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        }
                        return null;
                    };

                    /**
                     * Creates a GetStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.GetStateEntryMessage} GetStateEntryMessage
                     */
                    GetStateEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.GetStateEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.GetStateEntryMessage();
                        if (object.key != null)
                            if (typeof object.key === "string")
                                $util.base64.decode(object.key, message.key = $util.newBuffer($util.base64.length(object.key)), 0);
                            else if (object.key.length >= 0)
                                message.key = object.key;
                        if (object.empty != null) {
                            if (typeof object.empty !== "object")
                                throw TypeError(".dev.restate.service.protocol.GetStateEntryMessage.empty: object expected");
                            message.empty = $root.google.protobuf.Empty.fromObject(object.empty);
                        }
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        return message;
                    };

                    /**
                     * Creates a plain object from a GetStateEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.GetStateEntryMessage} message GetStateEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    GetStateEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults)
                            if (options.bytes === String)
                                object.key = "";
                            else {
                                object.key = [];
                                if (options.bytes !== Array)
                                    object.key = $util.newBuffer(object.key);
                            }
                        if (message.key != null && message.hasOwnProperty("key"))
                            object.key = options.bytes === String ? $util.base64.encode(message.key, 0, message.key.length) : options.bytes === Array ? Array.prototype.slice.call(message.key) : message.key;
                        if (message.empty != null && message.hasOwnProperty("empty")) {
                            object.empty = $root.google.protobuf.Empty.toObject(message.empty, options);
                            if (options.oneofs)
                                object.result = "empty";
                        }
                        if (message.value != null && message.hasOwnProperty("value")) {
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                            if (options.oneofs)
                                object.result = "value";
                        }
                        return object;
                    };

                    /**
                     * Converts this GetStateEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    GetStateEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for GetStateEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.GetStateEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    GetStateEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.GetStateEntryMessage";
                    };

                    return GetStateEntryMessage;
                })();

                protocol.SetStateEntryMessage = (function() {

                    /**
                     * Properties of a SetStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface ISetStateEntryMessage
                     * @property {Uint8Array|null} [key] SetStateEntryMessage key
                     * @property {Uint8Array|null} [value] SetStateEntryMessage value
                     */

                    /**
                     * Constructs a new SetStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a SetStateEntryMessage.
                     * @implements ISetStateEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.ISetStateEntryMessage=} [properties] Properties to set
                     */
                    function SetStateEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * SetStateEntryMessage key.
                     * @member {Uint8Array} key
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @instance
                     */
                    SetStateEntryMessage.prototype.key = $util.newBuffer([]);

                    /**
                     * SetStateEntryMessage value.
                     * @member {Uint8Array} value
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @instance
                     */
                    SetStateEntryMessage.prototype.value = $util.newBuffer([]);

                    /**
                     * Creates a new SetStateEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISetStateEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.SetStateEntryMessage} SetStateEntryMessage instance
                     */
                    SetStateEntryMessage.create = function create(properties) {
                        return new SetStateEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified SetStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.SetStateEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISetStateEntryMessage} message SetStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    SetStateEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.key != null && Object.hasOwnProperty.call(message, "key"))
                            writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.key);
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.value);
                        return writer;
                    };

                    /**
                     * Encodes the specified SetStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.SetStateEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISetStateEntryMessage} message SetStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    SetStateEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a SetStateEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.SetStateEntryMessage} SetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    SetStateEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.SetStateEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.key = reader.bytes();
                                    break;
                                }
                            case 3: {
                                    message.value = reader.bytes();
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
                     * Decodes a SetStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.SetStateEntryMessage} SetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    SetStateEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a SetStateEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    SetStateEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.key != null && message.hasOwnProperty("key"))
                            if (!(message.key && typeof message.key.length === "number" || $util.isString(message.key)))
                                return "key: buffer expected";
                        if (message.value != null && message.hasOwnProperty("value"))
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        return null;
                    };

                    /**
                     * Creates a SetStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.SetStateEntryMessage} SetStateEntryMessage
                     */
                    SetStateEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.SetStateEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.SetStateEntryMessage();
                        if (object.key != null)
                            if (typeof object.key === "string")
                                $util.base64.decode(object.key, message.key = $util.newBuffer($util.base64.length(object.key)), 0);
                            else if (object.key.length >= 0)
                                message.key = object.key;
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        return message;
                    };

                    /**
                     * Creates a plain object from a SetStateEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.SetStateEntryMessage} message SetStateEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    SetStateEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            if (options.bytes === String)
                                object.key = "";
                            else {
                                object.key = [];
                                if (options.bytes !== Array)
                                    object.key = $util.newBuffer(object.key);
                            }
                            if (options.bytes === String)
                                object.value = "";
                            else {
                                object.value = [];
                                if (options.bytes !== Array)
                                    object.value = $util.newBuffer(object.value);
                            }
                        }
                        if (message.key != null && message.hasOwnProperty("key"))
                            object.key = options.bytes === String ? $util.base64.encode(message.key, 0, message.key.length) : options.bytes === Array ? Array.prototype.slice.call(message.key) : message.key;
                        if (message.value != null && message.hasOwnProperty("value"))
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                        return object;
                    };

                    /**
                     * Converts this SetStateEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    SetStateEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for SetStateEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.SetStateEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    SetStateEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.SetStateEntryMessage";
                    };

                    return SetStateEntryMessage;
                })();

                protocol.ClearStateEntryMessage = (function() {

                    /**
                     * Properties of a ClearStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IClearStateEntryMessage
                     * @property {Uint8Array|null} [key] ClearStateEntryMessage key
                     */

                    /**
                     * Constructs a new ClearStateEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a ClearStateEntryMessage.
                     * @implements IClearStateEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IClearStateEntryMessage=} [properties] Properties to set
                     */
                    function ClearStateEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * ClearStateEntryMessage key.
                     * @member {Uint8Array} key
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @instance
                     */
                    ClearStateEntryMessage.prototype.key = $util.newBuffer([]);

                    /**
                     * Creates a new ClearStateEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IClearStateEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.ClearStateEntryMessage} ClearStateEntryMessage instance
                     */
                    ClearStateEntryMessage.create = function create(properties) {
                        return new ClearStateEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified ClearStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.ClearStateEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IClearStateEntryMessage} message ClearStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    ClearStateEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.key != null && Object.hasOwnProperty.call(message, "key"))
                            writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.key);
                        return writer;
                    };

                    /**
                     * Encodes the specified ClearStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.ClearStateEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IClearStateEntryMessage} message ClearStateEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    ClearStateEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a ClearStateEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.ClearStateEntryMessage} ClearStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    ClearStateEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.ClearStateEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.key = reader.bytes();
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
                     * Decodes a ClearStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.ClearStateEntryMessage} ClearStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    ClearStateEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a ClearStateEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    ClearStateEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.key != null && message.hasOwnProperty("key"))
                            if (!(message.key && typeof message.key.length === "number" || $util.isString(message.key)))
                                return "key: buffer expected";
                        return null;
                    };

                    /**
                     * Creates a ClearStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.ClearStateEntryMessage} ClearStateEntryMessage
                     */
                    ClearStateEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.ClearStateEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.ClearStateEntryMessage();
                        if (object.key != null)
                            if (typeof object.key === "string")
                                $util.base64.decode(object.key, message.key = $util.newBuffer($util.base64.length(object.key)), 0);
                            else if (object.key.length >= 0)
                                message.key = object.key;
                        return message;
                    };

                    /**
                     * Creates a plain object from a ClearStateEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ClearStateEntryMessage} message ClearStateEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    ClearStateEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults)
                            if (options.bytes === String)
                                object.key = "";
                            else {
                                object.key = [];
                                if (options.bytes !== Array)
                                    object.key = $util.newBuffer(object.key);
                            }
                        if (message.key != null && message.hasOwnProperty("key"))
                            object.key = options.bytes === String ? $util.base64.encode(message.key, 0, message.key.length) : options.bytes === Array ? Array.prototype.slice.call(message.key) : message.key;
                        return object;
                    };

                    /**
                     * Converts this ClearStateEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    ClearStateEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for ClearStateEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.ClearStateEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    ClearStateEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.ClearStateEntryMessage";
                    };

                    return ClearStateEntryMessage;
                })();

                protocol.SleepEntryMessage = (function() {

                    /**
                     * Properties of a SleepEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface ISleepEntryMessage
                     * @property {number|Long|null} [wakeUpTime] SleepEntryMessage wakeUpTime
                     * @property {google.protobuf.IEmpty|null} [result] SleepEntryMessage result
                     */

                    /**
                     * Constructs a new SleepEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a SleepEntryMessage.
                     * @implements ISleepEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.ISleepEntryMessage=} [properties] Properties to set
                     */
                    function SleepEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * SleepEntryMessage wakeUpTime.
                     * @member {number|Long} wakeUpTime
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @instance
                     */
                    SleepEntryMessage.prototype.wakeUpTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                    /**
                     * SleepEntryMessage result.
                     * @member {google.protobuf.IEmpty|null|undefined} result
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @instance
                     */
                    SleepEntryMessage.prototype.result = null;

                    /**
                     * Creates a new SleepEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISleepEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.SleepEntryMessage} SleepEntryMessage instance
                     */
                    SleepEntryMessage.create = function create(properties) {
                        return new SleepEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified SleepEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.SleepEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISleepEntryMessage} message SleepEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    SleepEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.wakeUpTime != null && Object.hasOwnProperty.call(message, "wakeUpTime"))
                            writer.uint32(/* id 1, wireType 0 =*/8).int64(message.wakeUpTime);
                        if (message.result != null && Object.hasOwnProperty.call(message, "result"))
                            $root.google.protobuf.Empty.encode(message.result, writer.uint32(/* id 13, wireType 2 =*/106).fork()).ldelim();
                        return writer;
                    };

                    /**
                     * Encodes the specified SleepEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.SleepEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ISleepEntryMessage} message SleepEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    SleepEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a SleepEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.SleepEntryMessage} SleepEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    SleepEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.SleepEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.wakeUpTime = reader.int64();
                                    break;
                                }
                            case 13: {
                                    message.result = $root.google.protobuf.Empty.decode(reader, reader.uint32());
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
                     * Decodes a SleepEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.SleepEntryMessage} SleepEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    SleepEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a SleepEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    SleepEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.wakeUpTime != null && message.hasOwnProperty("wakeUpTime"))
                            if (!$util.isInteger(message.wakeUpTime) && !(message.wakeUpTime && $util.isInteger(message.wakeUpTime.low) && $util.isInteger(message.wakeUpTime.high)))
                                return "wakeUpTime: integer|Long expected";
                        if (message.result != null && message.hasOwnProperty("result")) {
                            var error = $root.google.protobuf.Empty.verify(message.result);
                            if (error)
                                return "result." + error;
                        }
                        return null;
                    };

                    /**
                     * Creates a SleepEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.SleepEntryMessage} SleepEntryMessage
                     */
                    SleepEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.SleepEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.SleepEntryMessage();
                        if (object.wakeUpTime != null)
                            if ($util.Long)
                                (message.wakeUpTime = $util.Long.fromValue(object.wakeUpTime)).unsigned = false;
                            else if (typeof object.wakeUpTime === "string")
                                message.wakeUpTime = parseInt(object.wakeUpTime, 10);
                            else if (typeof object.wakeUpTime === "number")
                                message.wakeUpTime = object.wakeUpTime;
                            else if (typeof object.wakeUpTime === "object")
                                message.wakeUpTime = new $util.LongBits(object.wakeUpTime.low >>> 0, object.wakeUpTime.high >>> 0).toNumber();
                        if (object.result != null) {
                            if (typeof object.result !== "object")
                                throw TypeError(".dev.restate.service.protocol.SleepEntryMessage.result: object expected");
                            message.result = $root.google.protobuf.Empty.fromObject(object.result);
                        }
                        return message;
                    };

                    /**
                     * Creates a plain object from a SleepEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.SleepEntryMessage} message SleepEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    SleepEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            if ($util.Long) {
                                var long = new $util.Long(0, 0, false);
                                object.wakeUpTime = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                            } else
                                object.wakeUpTime = options.longs === String ? "0" : 0;
                            object.result = null;
                        }
                        if (message.wakeUpTime != null && message.hasOwnProperty("wakeUpTime"))
                            if (typeof message.wakeUpTime === "number")
                                object.wakeUpTime = options.longs === String ? String(message.wakeUpTime) : message.wakeUpTime;
                            else
                                object.wakeUpTime = options.longs === String ? $util.Long.prototype.toString.call(message.wakeUpTime) : options.longs === Number ? new $util.LongBits(message.wakeUpTime.low >>> 0, message.wakeUpTime.high >>> 0).toNumber() : message.wakeUpTime;
                        if (message.result != null && message.hasOwnProperty("result"))
                            object.result = $root.google.protobuf.Empty.toObject(message.result, options);
                        return object;
                    };

                    /**
                     * Converts this SleepEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    SleepEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for SleepEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.SleepEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    SleepEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.SleepEntryMessage";
                    };

                    return SleepEntryMessage;
                })();

                protocol.InvokeEntryMessage = (function() {

                    /**
                     * Properties of an InvokeEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IInvokeEntryMessage
                     * @property {string|null} [serviceName] InvokeEntryMessage serviceName
                     * @property {string|null} [methodName] InvokeEntryMessage methodName
                     * @property {Uint8Array|null} [parameter] InvokeEntryMessage parameter
                     * @property {Uint8Array|null} [value] InvokeEntryMessage value
                     * @property {dev.restate.service.protocol.IFailure|null} [failure] InvokeEntryMessage failure
                     */

                    /**
                     * Constructs a new InvokeEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents an InvokeEntryMessage.
                     * @implements IInvokeEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IInvokeEntryMessage=} [properties] Properties to set
                     */
                    function InvokeEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * InvokeEntryMessage serviceName.
                     * @member {string} serviceName
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    InvokeEntryMessage.prototype.serviceName = "";

                    /**
                     * InvokeEntryMessage methodName.
                     * @member {string} methodName
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    InvokeEntryMessage.prototype.methodName = "";

                    /**
                     * InvokeEntryMessage parameter.
                     * @member {Uint8Array} parameter
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    InvokeEntryMessage.prototype.parameter = $util.newBuffer([]);

                    /**
                     * InvokeEntryMessage value.
                     * @member {Uint8Array|null|undefined} value
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    InvokeEntryMessage.prototype.value = null;

                    /**
                     * InvokeEntryMessage failure.
                     * @member {dev.restate.service.protocol.IFailure|null|undefined} failure
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    InvokeEntryMessage.prototype.failure = null;

                    // OneOf field names bound to virtual getters and setters
                    var $oneOfFields;

                    /**
                     * InvokeEntryMessage result.
                     * @member {"value"|"failure"|undefined} result
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     */
                    Object.defineProperty(InvokeEntryMessage.prototype, "result", {
                        get: $util.oneOfGetter($oneOfFields = ["value", "failure"]),
                        set: $util.oneOfSetter($oneOfFields)
                    });

                    /**
                     * Creates a new InvokeEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IInvokeEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.InvokeEntryMessage} InvokeEntryMessage instance
                     */
                    InvokeEntryMessage.create = function create(properties) {
                        return new InvokeEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified InvokeEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.InvokeEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IInvokeEntryMessage} message InvokeEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    InvokeEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.serviceName != null && Object.hasOwnProperty.call(message, "serviceName"))
                            writer.uint32(/* id 1, wireType 2 =*/10).string(message.serviceName);
                        if (message.methodName != null && Object.hasOwnProperty.call(message, "methodName"))
                            writer.uint32(/* id 2, wireType 2 =*/18).string(message.methodName);
                        if (message.parameter != null && Object.hasOwnProperty.call(message, "parameter"))
                            writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.parameter);
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        if (message.failure != null && Object.hasOwnProperty.call(message, "failure"))
                            $root.dev.restate.service.protocol.Failure.encode(message.failure, writer.uint32(/* id 15, wireType 2 =*/122).fork()).ldelim();
                        return writer;
                    };

                    /**
                     * Encodes the specified InvokeEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.InvokeEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IInvokeEntryMessage} message InvokeEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    InvokeEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes an InvokeEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.InvokeEntryMessage} InvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    InvokeEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.InvokeEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.serviceName = reader.string();
                                    break;
                                }
                            case 2: {
                                    message.methodName = reader.string();
                                    break;
                                }
                            case 3: {
                                    message.parameter = reader.bytes();
                                    break;
                                }
                            case 14: {
                                    message.value = reader.bytes();
                                    break;
                                }
                            case 15: {
                                    message.failure = $root.dev.restate.service.protocol.Failure.decode(reader, reader.uint32());
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
                     * Decodes an InvokeEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.InvokeEntryMessage} InvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    InvokeEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies an InvokeEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    InvokeEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        var properties = {};
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            if (!$util.isString(message.serviceName))
                                return "serviceName: string expected";
                        if (message.methodName != null && message.hasOwnProperty("methodName"))
                            if (!$util.isString(message.methodName))
                                return "methodName: string expected";
                        if (message.parameter != null && message.hasOwnProperty("parameter"))
                            if (!(message.parameter && typeof message.parameter.length === "number" || $util.isString(message.parameter)))
                                return "parameter: buffer expected";
                        if (message.value != null && message.hasOwnProperty("value")) {
                            properties.result = 1;
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            {
                                var error = $root.dev.restate.service.protocol.Failure.verify(message.failure);
                                if (error)
                                    return "failure." + error;
                            }
                        }
                        return null;
                    };

                    /**
                     * Creates an InvokeEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.InvokeEntryMessage} InvokeEntryMessage
                     */
                    InvokeEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.InvokeEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.InvokeEntryMessage();
                        if (object.serviceName != null)
                            message.serviceName = String(object.serviceName);
                        if (object.methodName != null)
                            message.methodName = String(object.methodName);
                        if (object.parameter != null)
                            if (typeof object.parameter === "string")
                                $util.base64.decode(object.parameter, message.parameter = $util.newBuffer($util.base64.length(object.parameter)), 0);
                            else if (object.parameter.length >= 0)
                                message.parameter = object.parameter;
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        if (object.failure != null) {
                            if (typeof object.failure !== "object")
                                throw TypeError(".dev.restate.service.protocol.InvokeEntryMessage.failure: object expected");
                            message.failure = $root.dev.restate.service.protocol.Failure.fromObject(object.failure);
                        }
                        return message;
                    };

                    /**
                     * Creates a plain object from an InvokeEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.InvokeEntryMessage} message InvokeEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    InvokeEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            object.serviceName = "";
                            object.methodName = "";
                            if (options.bytes === String)
                                object.parameter = "";
                            else {
                                object.parameter = [];
                                if (options.bytes !== Array)
                                    object.parameter = $util.newBuffer(object.parameter);
                            }
                        }
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            object.serviceName = message.serviceName;
                        if (message.methodName != null && message.hasOwnProperty("methodName"))
                            object.methodName = message.methodName;
                        if (message.parameter != null && message.hasOwnProperty("parameter"))
                            object.parameter = options.bytes === String ? $util.base64.encode(message.parameter, 0, message.parameter.length) : options.bytes === Array ? Array.prototype.slice.call(message.parameter) : message.parameter;
                        if (message.value != null && message.hasOwnProperty("value")) {
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                            if (options.oneofs)
                                object.result = "value";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            object.failure = $root.dev.restate.service.protocol.Failure.toObject(message.failure, options);
                            if (options.oneofs)
                                object.result = "failure";
                        }
                        return object;
                    };

                    /**
                     * Converts this InvokeEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    InvokeEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for InvokeEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.InvokeEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    InvokeEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.InvokeEntryMessage";
                    };

                    return InvokeEntryMessage;
                })();

                protocol.BackgroundInvokeEntryMessage = (function() {

                    /**
                     * Properties of a BackgroundInvokeEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IBackgroundInvokeEntryMessage
                     * @property {string|null} [serviceName] BackgroundInvokeEntryMessage serviceName
                     * @property {string|null} [methodName] BackgroundInvokeEntryMessage methodName
                     * @property {Uint8Array|null} [parameter] BackgroundInvokeEntryMessage parameter
                     */

                    /**
                     * Constructs a new BackgroundInvokeEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a BackgroundInvokeEntryMessage.
                     * @implements IBackgroundInvokeEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IBackgroundInvokeEntryMessage=} [properties] Properties to set
                     */
                    function BackgroundInvokeEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * BackgroundInvokeEntryMessage serviceName.
                     * @member {string} serviceName
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @instance
                     */
                    BackgroundInvokeEntryMessage.prototype.serviceName = "";

                    /**
                     * BackgroundInvokeEntryMessage methodName.
                     * @member {string} methodName
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @instance
                     */
                    BackgroundInvokeEntryMessage.prototype.methodName = "";

                    /**
                     * BackgroundInvokeEntryMessage parameter.
                     * @member {Uint8Array} parameter
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @instance
                     */
                    BackgroundInvokeEntryMessage.prototype.parameter = $util.newBuffer([]);

                    /**
                     * Creates a new BackgroundInvokeEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IBackgroundInvokeEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.BackgroundInvokeEntryMessage} BackgroundInvokeEntryMessage instance
                     */
                    BackgroundInvokeEntryMessage.create = function create(properties) {
                        return new BackgroundInvokeEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified BackgroundInvokeEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.BackgroundInvokeEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IBackgroundInvokeEntryMessage} message BackgroundInvokeEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    BackgroundInvokeEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.serviceName != null && Object.hasOwnProperty.call(message, "serviceName"))
                            writer.uint32(/* id 1, wireType 2 =*/10).string(message.serviceName);
                        if (message.methodName != null && Object.hasOwnProperty.call(message, "methodName"))
                            writer.uint32(/* id 2, wireType 2 =*/18).string(message.methodName);
                        if (message.parameter != null && Object.hasOwnProperty.call(message, "parameter"))
                            writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.parameter);
                        return writer;
                    };

                    /**
                     * Encodes the specified BackgroundInvokeEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.BackgroundInvokeEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IBackgroundInvokeEntryMessage} message BackgroundInvokeEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    BackgroundInvokeEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a BackgroundInvokeEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.BackgroundInvokeEntryMessage} BackgroundInvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    BackgroundInvokeEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.BackgroundInvokeEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.serviceName = reader.string();
                                    break;
                                }
                            case 2: {
                                    message.methodName = reader.string();
                                    break;
                                }
                            case 3: {
                                    message.parameter = reader.bytes();
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
                     * Decodes a BackgroundInvokeEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.BackgroundInvokeEntryMessage} BackgroundInvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    BackgroundInvokeEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a BackgroundInvokeEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    BackgroundInvokeEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            if (!$util.isString(message.serviceName))
                                return "serviceName: string expected";
                        if (message.methodName != null && message.hasOwnProperty("methodName"))
                            if (!$util.isString(message.methodName))
                                return "methodName: string expected";
                        if (message.parameter != null && message.hasOwnProperty("parameter"))
                            if (!(message.parameter && typeof message.parameter.length === "number" || $util.isString(message.parameter)))
                                return "parameter: buffer expected";
                        return null;
                    };

                    /**
                     * Creates a BackgroundInvokeEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.BackgroundInvokeEntryMessage} BackgroundInvokeEntryMessage
                     */
                    BackgroundInvokeEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.BackgroundInvokeEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.BackgroundInvokeEntryMessage();
                        if (object.serviceName != null)
                            message.serviceName = String(object.serviceName);
                        if (object.methodName != null)
                            message.methodName = String(object.methodName);
                        if (object.parameter != null)
                            if (typeof object.parameter === "string")
                                $util.base64.decode(object.parameter, message.parameter = $util.newBuffer($util.base64.length(object.parameter)), 0);
                            else if (object.parameter.length >= 0)
                                message.parameter = object.parameter;
                        return message;
                    };

                    /**
                     * Creates a plain object from a BackgroundInvokeEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.BackgroundInvokeEntryMessage} message BackgroundInvokeEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    BackgroundInvokeEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            object.serviceName = "";
                            object.methodName = "";
                            if (options.bytes === String)
                                object.parameter = "";
                            else {
                                object.parameter = [];
                                if (options.bytes !== Array)
                                    object.parameter = $util.newBuffer(object.parameter);
                            }
                        }
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            object.serviceName = message.serviceName;
                        if (message.methodName != null && message.hasOwnProperty("methodName"))
                            object.methodName = message.methodName;
                        if (message.parameter != null && message.hasOwnProperty("parameter"))
                            object.parameter = options.bytes === String ? $util.base64.encode(message.parameter, 0, message.parameter.length) : options.bytes === Array ? Array.prototype.slice.call(message.parameter) : message.parameter;
                        return object;
                    };

                    /**
                     * Converts this BackgroundInvokeEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    BackgroundInvokeEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for BackgroundInvokeEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.BackgroundInvokeEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    BackgroundInvokeEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.BackgroundInvokeEntryMessage";
                    };

                    return BackgroundInvokeEntryMessage;
                })();

                protocol.AwakeableEntryMessage = (function() {

                    /**
                     * Properties of an AwakeableEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface IAwakeableEntryMessage
                     * @property {Uint8Array|null} [value] AwakeableEntryMessage value
                     * @property {dev.restate.service.protocol.IFailure|null} [failure] AwakeableEntryMessage failure
                     */

                    /**
                     * Constructs a new AwakeableEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents an AwakeableEntryMessage.
                     * @implements IAwakeableEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.IAwakeableEntryMessage=} [properties] Properties to set
                     */
                    function AwakeableEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * AwakeableEntryMessage value.
                     * @member {Uint8Array|null|undefined} value
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @instance
                     */
                    AwakeableEntryMessage.prototype.value = null;

                    /**
                     * AwakeableEntryMessage failure.
                     * @member {dev.restate.service.protocol.IFailure|null|undefined} failure
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @instance
                     */
                    AwakeableEntryMessage.prototype.failure = null;

                    // OneOf field names bound to virtual getters and setters
                    var $oneOfFields;

                    /**
                     * AwakeableEntryMessage result.
                     * @member {"value"|"failure"|undefined} result
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @instance
                     */
                    Object.defineProperty(AwakeableEntryMessage.prototype, "result", {
                        get: $util.oneOfGetter($oneOfFields = ["value", "failure"]),
                        set: $util.oneOfSetter($oneOfFields)
                    });

                    /**
                     * Creates a new AwakeableEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IAwakeableEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.AwakeableEntryMessage} AwakeableEntryMessage instance
                     */
                    AwakeableEntryMessage.create = function create(properties) {
                        return new AwakeableEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified AwakeableEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.AwakeableEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IAwakeableEntryMessage} message AwakeableEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    AwakeableEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.value != null && Object.hasOwnProperty.call(message, "value"))
                            writer.uint32(/* id 14, wireType 2 =*/114).bytes(message.value);
                        if (message.failure != null && Object.hasOwnProperty.call(message, "failure"))
                            $root.dev.restate.service.protocol.Failure.encode(message.failure, writer.uint32(/* id 15, wireType 2 =*/122).fork()).ldelim();
                        return writer;
                    };

                    /**
                     * Encodes the specified AwakeableEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.AwakeableEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.IAwakeableEntryMessage} message AwakeableEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    AwakeableEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes an AwakeableEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.AwakeableEntryMessage} AwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    AwakeableEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.AwakeableEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 14: {
                                    message.value = reader.bytes();
                                    break;
                                }
                            case 15: {
                                    message.failure = $root.dev.restate.service.protocol.Failure.decode(reader, reader.uint32());
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
                     * Decodes an AwakeableEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.AwakeableEntryMessage} AwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    AwakeableEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies an AwakeableEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    AwakeableEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        var properties = {};
                        if (message.value != null && message.hasOwnProperty("value")) {
                            properties.result = 1;
                            if (!(message.value && typeof message.value.length === "number" || $util.isString(message.value)))
                                return "value: buffer expected";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            if (properties.result === 1)
                                return "result: multiple values";
                            properties.result = 1;
                            {
                                var error = $root.dev.restate.service.protocol.Failure.verify(message.failure);
                                if (error)
                                    return "failure." + error;
                            }
                        }
                        return null;
                    };

                    /**
                     * Creates an AwakeableEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.AwakeableEntryMessage} AwakeableEntryMessage
                     */
                    AwakeableEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.AwakeableEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.AwakeableEntryMessage();
                        if (object.value != null)
                            if (typeof object.value === "string")
                                $util.base64.decode(object.value, message.value = $util.newBuffer($util.base64.length(object.value)), 0);
                            else if (object.value.length >= 0)
                                message.value = object.value;
                        if (object.failure != null) {
                            if (typeof object.failure !== "object")
                                throw TypeError(".dev.restate.service.protocol.AwakeableEntryMessage.failure: object expected");
                            message.failure = $root.dev.restate.service.protocol.Failure.fromObject(object.failure);
                        }
                        return message;
                    };

                    /**
                     * Creates a plain object from an AwakeableEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.AwakeableEntryMessage} message AwakeableEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    AwakeableEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (message.value != null && message.hasOwnProperty("value")) {
                            object.value = options.bytes === String ? $util.base64.encode(message.value, 0, message.value.length) : options.bytes === Array ? Array.prototype.slice.call(message.value) : message.value;
                            if (options.oneofs)
                                object.result = "value";
                        }
                        if (message.failure != null && message.hasOwnProperty("failure")) {
                            object.failure = $root.dev.restate.service.protocol.Failure.toObject(message.failure, options);
                            if (options.oneofs)
                                object.result = "failure";
                        }
                        return object;
                    };

                    /**
                     * Converts this AwakeableEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    AwakeableEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for AwakeableEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.AwakeableEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    AwakeableEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.AwakeableEntryMessage";
                    };

                    return AwakeableEntryMessage;
                })();

                protocol.CompleteAwakeableEntryMessage = (function() {

                    /**
                     * Properties of a CompleteAwakeableEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @interface ICompleteAwakeableEntryMessage
                     * @property {string|null} [serviceName] CompleteAwakeableEntryMessage serviceName
                     * @property {Uint8Array|null} [instanceKey] CompleteAwakeableEntryMessage instanceKey
                     * @property {Uint8Array|null} [invocationId] CompleteAwakeableEntryMessage invocationId
                     * @property {number|null} [entryIndex] CompleteAwakeableEntryMessage entryIndex
                     * @property {Uint8Array|null} [payload] CompleteAwakeableEntryMessage payload
                     */

                    /**
                     * Constructs a new CompleteAwakeableEntryMessage.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a CompleteAwakeableEntryMessage.
                     * @implements ICompleteAwakeableEntryMessage
                     * @constructor
                     * @param {dev.restate.service.protocol.ICompleteAwakeableEntryMessage=} [properties] Properties to set
                     */
                    function CompleteAwakeableEntryMessage(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * CompleteAwakeableEntryMessage serviceName.
                     * @member {string} serviceName
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     */
                    CompleteAwakeableEntryMessage.prototype.serviceName = "";

                    /**
                     * CompleteAwakeableEntryMessage instanceKey.
                     * @member {Uint8Array} instanceKey
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     */
                    CompleteAwakeableEntryMessage.prototype.instanceKey = $util.newBuffer([]);

                    /**
                     * CompleteAwakeableEntryMessage invocationId.
                     * @member {Uint8Array} invocationId
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     */
                    CompleteAwakeableEntryMessage.prototype.invocationId = $util.newBuffer([]);

                    /**
                     * CompleteAwakeableEntryMessage entryIndex.
                     * @member {number} entryIndex
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     */
                    CompleteAwakeableEntryMessage.prototype.entryIndex = 0;

                    /**
                     * CompleteAwakeableEntryMessage payload.
                     * @member {Uint8Array} payload
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     */
                    CompleteAwakeableEntryMessage.prototype.payload = $util.newBuffer([]);

                    /**
                     * Creates a new CompleteAwakeableEntryMessage instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompleteAwakeableEntryMessage=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.CompleteAwakeableEntryMessage} CompleteAwakeableEntryMessage instance
                     */
                    CompleteAwakeableEntryMessage.create = function create(properties) {
                        return new CompleteAwakeableEntryMessage(properties);
                    };

                    /**
                     * Encodes the specified CompleteAwakeableEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.CompleteAwakeableEntryMessage.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompleteAwakeableEntryMessage} message CompleteAwakeableEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    CompleteAwakeableEntryMessage.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.serviceName != null && Object.hasOwnProperty.call(message, "serviceName"))
                            writer.uint32(/* id 1, wireType 2 =*/10).string(message.serviceName);
                        if (message.instanceKey != null && Object.hasOwnProperty.call(message, "instanceKey"))
                            writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.instanceKey);
                        if (message.invocationId != null && Object.hasOwnProperty.call(message, "invocationId"))
                            writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.invocationId);
                        if (message.entryIndex != null && Object.hasOwnProperty.call(message, "entryIndex"))
                            writer.uint32(/* id 4, wireType 0 =*/32).uint32(message.entryIndex);
                        if (message.payload != null && Object.hasOwnProperty.call(message, "payload"))
                            writer.uint32(/* id 5, wireType 2 =*/42).bytes(message.payload);
                        return writer;
                    };

                    /**
                     * Encodes the specified CompleteAwakeableEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.CompleteAwakeableEntryMessage.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.ICompleteAwakeableEntryMessage} message CompleteAwakeableEntryMessage message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    CompleteAwakeableEntryMessage.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a CompleteAwakeableEntryMessage message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.CompleteAwakeableEntryMessage} CompleteAwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    CompleteAwakeableEntryMessage.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.CompleteAwakeableEntryMessage();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.serviceName = reader.string();
                                    break;
                                }
                            case 2: {
                                    message.instanceKey = reader.bytes();
                                    break;
                                }
                            case 3: {
                                    message.invocationId = reader.bytes();
                                    break;
                                }
                            case 4: {
                                    message.entryIndex = reader.uint32();
                                    break;
                                }
                            case 5: {
                                    message.payload = reader.bytes();
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
                     * Decodes a CompleteAwakeableEntryMessage message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.CompleteAwakeableEntryMessage} CompleteAwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    CompleteAwakeableEntryMessage.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a CompleteAwakeableEntryMessage message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    CompleteAwakeableEntryMessage.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            if (!$util.isString(message.serviceName))
                                return "serviceName: string expected";
                        if (message.instanceKey != null && message.hasOwnProperty("instanceKey"))
                            if (!(message.instanceKey && typeof message.instanceKey.length === "number" || $util.isString(message.instanceKey)))
                                return "instanceKey: buffer expected";
                        if (message.invocationId != null && message.hasOwnProperty("invocationId"))
                            if (!(message.invocationId && typeof message.invocationId.length === "number" || $util.isString(message.invocationId)))
                                return "invocationId: buffer expected";
                        if (message.entryIndex != null && message.hasOwnProperty("entryIndex"))
                            if (!$util.isInteger(message.entryIndex))
                                return "entryIndex: integer expected";
                        if (message.payload != null && message.hasOwnProperty("payload"))
                            if (!(message.payload && typeof message.payload.length === "number" || $util.isString(message.payload)))
                                return "payload: buffer expected";
                        return null;
                    };

                    /**
                     * Creates a CompleteAwakeableEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.CompleteAwakeableEntryMessage} CompleteAwakeableEntryMessage
                     */
                    CompleteAwakeableEntryMessage.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.CompleteAwakeableEntryMessage)
                            return object;
                        var message = new $root.dev.restate.service.protocol.CompleteAwakeableEntryMessage();
                        if (object.serviceName != null)
                            message.serviceName = String(object.serviceName);
                        if (object.instanceKey != null)
                            if (typeof object.instanceKey === "string")
                                $util.base64.decode(object.instanceKey, message.instanceKey = $util.newBuffer($util.base64.length(object.instanceKey)), 0);
                            else if (object.instanceKey.length >= 0)
                                message.instanceKey = object.instanceKey;
                        if (object.invocationId != null)
                            if (typeof object.invocationId === "string")
                                $util.base64.decode(object.invocationId, message.invocationId = $util.newBuffer($util.base64.length(object.invocationId)), 0);
                            else if (object.invocationId.length >= 0)
                                message.invocationId = object.invocationId;
                        if (object.entryIndex != null)
                            message.entryIndex = object.entryIndex >>> 0;
                        if (object.payload != null)
                            if (typeof object.payload === "string")
                                $util.base64.decode(object.payload, message.payload = $util.newBuffer($util.base64.length(object.payload)), 0);
                            else if (object.payload.length >= 0)
                                message.payload = object.payload;
                        return message;
                    };

                    /**
                     * Creates a plain object from a CompleteAwakeableEntryMessage message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {dev.restate.service.protocol.CompleteAwakeableEntryMessage} message CompleteAwakeableEntryMessage
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    CompleteAwakeableEntryMessage.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            object.serviceName = "";
                            if (options.bytes === String)
                                object.instanceKey = "";
                            else {
                                object.instanceKey = [];
                                if (options.bytes !== Array)
                                    object.instanceKey = $util.newBuffer(object.instanceKey);
                            }
                            if (options.bytes === String)
                                object.invocationId = "";
                            else {
                                object.invocationId = [];
                                if (options.bytes !== Array)
                                    object.invocationId = $util.newBuffer(object.invocationId);
                            }
                            object.entryIndex = 0;
                            if (options.bytes === String)
                                object.payload = "";
                            else {
                                object.payload = [];
                                if (options.bytes !== Array)
                                    object.payload = $util.newBuffer(object.payload);
                            }
                        }
                        if (message.serviceName != null && message.hasOwnProperty("serviceName"))
                            object.serviceName = message.serviceName;
                        if (message.instanceKey != null && message.hasOwnProperty("instanceKey"))
                            object.instanceKey = options.bytes === String ? $util.base64.encode(message.instanceKey, 0, message.instanceKey.length) : options.bytes === Array ? Array.prototype.slice.call(message.instanceKey) : message.instanceKey;
                        if (message.invocationId != null && message.hasOwnProperty("invocationId"))
                            object.invocationId = options.bytes === String ? $util.base64.encode(message.invocationId, 0, message.invocationId.length) : options.bytes === Array ? Array.prototype.slice.call(message.invocationId) : message.invocationId;
                        if (message.entryIndex != null && message.hasOwnProperty("entryIndex"))
                            object.entryIndex = message.entryIndex;
                        if (message.payload != null && message.hasOwnProperty("payload"))
                            object.payload = options.bytes === String ? $util.base64.encode(message.payload, 0, message.payload.length) : options.bytes === Array ? Array.prototype.slice.call(message.payload) : message.payload;
                        return object;
                    };

                    /**
                     * Converts this CompleteAwakeableEntryMessage to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    CompleteAwakeableEntryMessage.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for CompleteAwakeableEntryMessage
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.CompleteAwakeableEntryMessage
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    CompleteAwakeableEntryMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.CompleteAwakeableEntryMessage";
                    };

                    return CompleteAwakeableEntryMessage;
                })();

                protocol.Failure = (function() {

                    /**
                     * Properties of a Failure.
                     * @memberof dev.restate.service.protocol
                     * @interface IFailure
                     * @property {number|null} [code] Failure code
                     * @property {string|null} [message] Failure message
                     */

                    /**
                     * Constructs a new Failure.
                     * @memberof dev.restate.service.protocol
                     * @classdesc Represents a Failure.
                     * @implements IFailure
                     * @constructor
                     * @param {dev.restate.service.protocol.IFailure=} [properties] Properties to set
                     */
                    function Failure(properties) {
                        if (properties)
                            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                if (properties[keys[i]] != null)
                                    this[keys[i]] = properties[keys[i]];
                    }

                    /**
                     * Failure code.
                     * @member {number} code
                     * @memberof dev.restate.service.protocol.Failure
                     * @instance
                     */
                    Failure.prototype.code = 0;

                    /**
                     * Failure message.
                     * @member {string} message
                     * @memberof dev.restate.service.protocol.Failure
                     * @instance
                     */
                    Failure.prototype.message = "";

                    /**
                     * Creates a new Failure instance using the specified properties.
                     * @function create
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {dev.restate.service.protocol.IFailure=} [properties] Properties to set
                     * @returns {dev.restate.service.protocol.Failure} Failure instance
                     */
                    Failure.create = function create(properties) {
                        return new Failure(properties);
                    };

                    /**
                     * Encodes the specified Failure message. Does not implicitly {@link dev.restate.service.protocol.Failure.verify|verify} messages.
                     * @function encode
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {dev.restate.service.protocol.IFailure} message Failure message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    Failure.encode = function encode(message, writer) {
                        if (!writer)
                            writer = $Writer.create();
                        if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                            writer.uint32(/* id 1, wireType 0 =*/8).int32(message.code);
                        if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                            writer.uint32(/* id 2, wireType 2 =*/18).string(message.message);
                        return writer;
                    };

                    /**
                     * Encodes the specified Failure message, length delimited. Does not implicitly {@link dev.restate.service.protocol.Failure.verify|verify} messages.
                     * @function encodeDelimited
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {dev.restate.service.protocol.IFailure} message Failure message or plain object to encode
                     * @param {$protobuf.Writer} [writer] Writer to encode to
                     * @returns {$protobuf.Writer} Writer
                     */
                    Failure.encodeDelimited = function encodeDelimited(message, writer) {
                        return this.encode(message, writer).ldelim();
                    };

                    /**
                     * Decodes a Failure message from the specified reader or buffer.
                     * @function decode
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @param {number} [length] Message length if known beforehand
                     * @returns {dev.restate.service.protocol.Failure} Failure
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    Failure.decode = function decode(reader, length) {
                        if (!(reader instanceof $Reader))
                            reader = $Reader.create(reader);
                        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.dev.restate.service.protocol.Failure();
                        while (reader.pos < end) {
                            var tag = reader.uint32();
                            switch (tag >>> 3) {
                            case 1: {
                                    message.code = reader.int32();
                                    break;
                                }
                            case 2: {
                                    message.message = reader.string();
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
                     * Decodes a Failure message from the specified reader or buffer, length delimited.
                     * @function decodeDelimited
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                     * @returns {dev.restate.service.protocol.Failure} Failure
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    Failure.decodeDelimited = function decodeDelimited(reader) {
                        if (!(reader instanceof $Reader))
                            reader = new $Reader(reader);
                        return this.decode(reader, reader.uint32());
                    };

                    /**
                     * Verifies a Failure message.
                     * @function verify
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {Object.<string,*>} message Plain object to verify
                     * @returns {string|null} `null` if valid, otherwise the reason why it is not
                     */
                    Failure.verify = function verify(message) {
                        if (typeof message !== "object" || message === null)
                            return "object expected";
                        if (message.code != null && message.hasOwnProperty("code"))
                            if (!$util.isInteger(message.code))
                                return "code: integer expected";
                        if (message.message != null && message.hasOwnProperty("message"))
                            if (!$util.isString(message.message))
                                return "message: string expected";
                        return null;
                    };

                    /**
                     * Creates a Failure message from a plain object. Also converts values to their respective internal types.
                     * @function fromObject
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {Object.<string,*>} object Plain object
                     * @returns {dev.restate.service.protocol.Failure} Failure
                     */
                    Failure.fromObject = function fromObject(object) {
                        if (object instanceof $root.dev.restate.service.protocol.Failure)
                            return object;
                        var message = new $root.dev.restate.service.protocol.Failure();
                        if (object.code != null)
                            message.code = object.code | 0;
                        if (object.message != null)
                            message.message = String(object.message);
                        return message;
                    };

                    /**
                     * Creates a plain object from a Failure message. Also converts values to other types if specified.
                     * @function toObject
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {dev.restate.service.protocol.Failure} message Failure
                     * @param {$protobuf.IConversionOptions} [options] Conversion options
                     * @returns {Object.<string,*>} Plain object
                     */
                    Failure.toObject = function toObject(message, options) {
                        if (!options)
                            options = {};
                        var object = {};
                        if (options.defaults) {
                            object.code = 0;
                            object.message = "";
                        }
                        if (message.code != null && message.hasOwnProperty("code"))
                            object.code = message.code;
                        if (message.message != null && message.hasOwnProperty("message"))
                            object.message = message.message;
                        return object;
                    };

                    /**
                     * Converts this Failure to JSON.
                     * @function toJSON
                     * @memberof dev.restate.service.protocol.Failure
                     * @instance
                     * @returns {Object.<string,*>} JSON object
                     */
                    Failure.prototype.toJSON = function toJSON() {
                        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                    };

                    /**
                     * Gets the default type url for Failure
                     * @function getTypeUrl
                     * @memberof dev.restate.service.protocol.Failure
                     * @static
                     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns {string} The default type url
                     */
                    Failure.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                        if (typeUrlPrefix === undefined) {
                            typeUrlPrefix = "type.googleapis.com";
                        }
                        return typeUrlPrefix + "/dev.restate.service.protocol.Failure";
                    };

                    return Failure;
                })();

                return protocol;
            })();

            return service;
        })();

        return restate;
    })();

    return dev;
})();

$root.google = (function() {

    /**
     * Namespace google.
     * @exports google
     * @namespace
     */
    var google = {};

    google.protobuf = (function() {

        /**
         * Namespace protobuf.
         * @memberof google
         * @namespace
         */
        var protobuf = {};

        protobuf.Empty = (function() {

            /**
             * Properties of an Empty.
             * @memberof google.protobuf
             * @interface IEmpty
             */

            /**
             * Constructs a new Empty.
             * @memberof google.protobuf
             * @classdesc Represents an Empty.
             * @implements IEmpty
             * @constructor
             * @param {google.protobuf.IEmpty=} [properties] Properties to set
             */
            function Empty(properties) {
                if (properties)
                    for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Creates a new Empty instance using the specified properties.
             * @function create
             * @memberof google.protobuf.Empty
             * @static
             * @param {google.protobuf.IEmpty=} [properties] Properties to set
             * @returns {google.protobuf.Empty} Empty instance
             */
            Empty.create = function create(properties) {
                return new Empty(properties);
            };

            /**
             * Encodes the specified Empty message. Does not implicitly {@link google.protobuf.Empty.verify|verify} messages.
             * @function encode
             * @memberof google.protobuf.Empty
             * @static
             * @param {google.protobuf.IEmpty} message Empty message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Empty.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                return writer;
            };

            /**
             * Encodes the specified Empty message, length delimited. Does not implicitly {@link google.protobuf.Empty.verify|verify} messages.
             * @function encodeDelimited
             * @memberof google.protobuf.Empty
             * @static
             * @param {google.protobuf.IEmpty} message Empty message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Empty.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes an Empty message from the specified reader or buffer.
             * @function decode
             * @memberof google.protobuf.Empty
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {google.protobuf.Empty} Empty
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Empty.decode = function decode(reader, length) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                var end = length === undefined ? reader.len : reader.pos + length, message = new $root.google.protobuf.Empty();
                while (reader.pos < end) {
                    var tag = reader.uint32();
                    switch (tag >>> 3) {
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an Empty message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof google.protobuf.Empty
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {google.protobuf.Empty} Empty
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Empty.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an Empty message.
             * @function verify
             * @memberof google.protobuf.Empty
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Empty.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                return null;
            };

            /**
             * Creates an Empty message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof google.protobuf.Empty
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {google.protobuf.Empty} Empty
             */
            Empty.fromObject = function fromObject(object) {
                if (object instanceof $root.google.protobuf.Empty)
                    return object;
                return new $root.google.protobuf.Empty();
            };

            /**
             * Creates a plain object from an Empty message. Also converts values to other types if specified.
             * @function toObject
             * @memberof google.protobuf.Empty
             * @static
             * @param {google.protobuf.Empty} message Empty
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Empty.toObject = function toObject() {
                return {};
            };

            /**
             * Converts this Empty to JSON.
             * @function toJSON
             * @memberof google.protobuf.Empty
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Empty.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Empty
             * @function getTypeUrl
             * @memberof google.protobuf.Empty
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Empty.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/google.protobuf.Empty";
            };

            return Empty;
        })();

        return protobuf;
    })();

    return google;
})();

module.exports = $root;
