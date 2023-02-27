import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace dev. */
export namespace dev {

    /** Namespace restate. */
    namespace restate {

        /** Namespace service. */
        namespace service {

            /** Namespace protocol. */
            namespace protocol {

                /** Properties of a StartMessage. */
                interface IStartMessage {

                    /** StartMessage invocationId */
                    invocationId?: (Uint8Array|null);

                    /** StartMessage instanceKey */
                    instanceKey?: (Uint8Array|null);

                    /** StartMessage knownServiceVersion */
                    knownServiceVersion?: (number|null);

                    /** StartMessage knownEntries */
                    knownEntries?: (number|null);
                }

                /** Represents a StartMessage. */
                class StartMessage implements IStartMessage {

                    /**
                     * Constructs a new StartMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IStartMessage);

                    /** StartMessage invocationId. */
                    public invocationId: Uint8Array;

                    /** StartMessage instanceKey. */
                    public instanceKey: Uint8Array;

                    /** StartMessage knownServiceVersion. */
                    public knownServiceVersion: number;

                    /** StartMessage knownEntries. */
                    public knownEntries: number;

                    /**
                     * Creates a new StartMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns StartMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IStartMessage): dev.restate.service.protocol.StartMessage;

                    /**
                     * Encodes the specified StartMessage message. Does not implicitly {@link dev.restate.service.protocol.StartMessage.verify|verify} messages.
                     * @param message StartMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IStartMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified StartMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.StartMessage.verify|verify} messages.
                     * @param message StartMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IStartMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a StartMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns StartMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.StartMessage;

                    /**
                     * Decodes a StartMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns StartMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.StartMessage;

                    /**
                     * Verifies a StartMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a StartMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns StartMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.StartMessage;

                    /**
                     * Creates a plain object from a StartMessage message. Also converts values to other types if specified.
                     * @param message StartMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.StartMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this StartMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for StartMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a CompletionMessage. */
                interface ICompletionMessage {

                    /** CompletionMessage entryIndex */
                    entryIndex?: (number|null);

                    /** CompletionMessage empty */
                    empty?: (google.protobuf.IEmpty|null);

                    /** CompletionMessage value */
                    value?: (Uint8Array|null);

                    /** CompletionMessage failure */
                    failure?: (dev.restate.service.protocol.IFailure|null);
                }

                /** Represents a CompletionMessage. */
                class CompletionMessage implements ICompletionMessage {

                    /**
                     * Constructs a new CompletionMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.ICompletionMessage);

                    /** CompletionMessage entryIndex. */
                    public entryIndex: number;

                    /** CompletionMessage empty. */
                    public empty?: (google.protobuf.IEmpty|null);

                    /** CompletionMessage value. */
                    public value?: (Uint8Array|null);

                    /** CompletionMessage failure. */
                    public failure?: (dev.restate.service.protocol.IFailure|null);

                    /** CompletionMessage result. */
                    public result?: ("empty"|"value"|"failure");

                    /**
                     * Creates a new CompletionMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns CompletionMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.ICompletionMessage): dev.restate.service.protocol.CompletionMessage;

                    /**
                     * Encodes the specified CompletionMessage message. Does not implicitly {@link dev.restate.service.protocol.CompletionMessage.verify|verify} messages.
                     * @param message CompletionMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.ICompletionMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified CompletionMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.CompletionMessage.verify|verify} messages.
                     * @param message CompletionMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.ICompletionMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a CompletionMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns CompletionMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.CompletionMessage;

                    /**
                     * Decodes a CompletionMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns CompletionMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.CompletionMessage;

                    /**
                     * Verifies a CompletionMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a CompletionMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns CompletionMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.CompletionMessage;

                    /**
                     * Creates a plain object from a CompletionMessage message. Also converts values to other types if specified.
                     * @param message CompletionMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.CompletionMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this CompletionMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for CompletionMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a PollInputStreamEntryMessage. */
                interface IPollInputStreamEntryMessage {

                    /** PollInputStreamEntryMessage value */
                    value?: (Uint8Array|null);
                }

                /** Represents a PollInputStreamEntryMessage. */
                class PollInputStreamEntryMessage implements IPollInputStreamEntryMessage {

                    /**
                     * Constructs a new PollInputStreamEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IPollInputStreamEntryMessage);

                    /** PollInputStreamEntryMessage value. */
                    public value: Uint8Array;

                    /**
                     * Creates a new PollInputStreamEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns PollInputStreamEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IPollInputStreamEntryMessage): dev.restate.service.protocol.PollInputStreamEntryMessage;

                    /**
                     * Encodes the specified PollInputStreamEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.PollInputStreamEntryMessage.verify|verify} messages.
                     * @param message PollInputStreamEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IPollInputStreamEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified PollInputStreamEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.PollInputStreamEntryMessage.verify|verify} messages.
                     * @param message PollInputStreamEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IPollInputStreamEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a PollInputStreamEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns PollInputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.PollInputStreamEntryMessage;

                    /**
                     * Decodes a PollInputStreamEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns PollInputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.PollInputStreamEntryMessage;

                    /**
                     * Verifies a PollInputStreamEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a PollInputStreamEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns PollInputStreamEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.PollInputStreamEntryMessage;

                    /**
                     * Creates a plain object from a PollInputStreamEntryMessage message. Also converts values to other types if specified.
                     * @param message PollInputStreamEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.PollInputStreamEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this PollInputStreamEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for PollInputStreamEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of an OutputStreamEntryMessage. */
                interface IOutputStreamEntryMessage {

                    /** OutputStreamEntryMessage value */
                    value?: (Uint8Array|null);

                    /** OutputStreamEntryMessage failure */
                    failure?: (dev.restate.service.protocol.IFailure|null);
                }

                /** Represents an OutputStreamEntryMessage. */
                class OutputStreamEntryMessage implements IOutputStreamEntryMessage {

                    /**
                     * Constructs a new OutputStreamEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IOutputStreamEntryMessage);

                    /** OutputStreamEntryMessage value. */
                    public value?: (Uint8Array|null);

                    /** OutputStreamEntryMessage failure. */
                    public failure?: (dev.restate.service.protocol.IFailure|null);

                    /** OutputStreamEntryMessage result. */
                    public result?: ("value"|"failure");

                    /**
                     * Creates a new OutputStreamEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns OutputStreamEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IOutputStreamEntryMessage): dev.restate.service.protocol.OutputStreamEntryMessage;

                    /**
                     * Encodes the specified OutputStreamEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.OutputStreamEntryMessage.verify|verify} messages.
                     * @param message OutputStreamEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IOutputStreamEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified OutputStreamEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.OutputStreamEntryMessage.verify|verify} messages.
                     * @param message OutputStreamEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IOutputStreamEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes an OutputStreamEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns OutputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.OutputStreamEntryMessage;

                    /**
                     * Decodes an OutputStreamEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns OutputStreamEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.OutputStreamEntryMessage;

                    /**
                     * Verifies an OutputStreamEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates an OutputStreamEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns OutputStreamEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.OutputStreamEntryMessage;

                    /**
                     * Creates a plain object from an OutputStreamEntryMessage message. Also converts values to other types if specified.
                     * @param message OutputStreamEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.OutputStreamEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this OutputStreamEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for OutputStreamEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a GetStateEntryMessage. */
                interface IGetStateEntryMessage {

                    /** GetStateEntryMessage key */
                    key?: (Uint8Array|null);

                    /** GetStateEntryMessage empty */
                    empty?: (google.protobuf.IEmpty|null);

                    /** GetStateEntryMessage value */
                    value?: (Uint8Array|null);
                }

                /** Represents a GetStateEntryMessage. */
                class GetStateEntryMessage implements IGetStateEntryMessage {

                    /**
                     * Constructs a new GetStateEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IGetStateEntryMessage);

                    /** GetStateEntryMessage key. */
                    public key: Uint8Array;

                    /** GetStateEntryMessage empty. */
                    public empty?: (google.protobuf.IEmpty|null);

                    /** GetStateEntryMessage value. */
                    public value?: (Uint8Array|null);

                    /** GetStateEntryMessage result. */
                    public result?: ("empty"|"value");

                    /**
                     * Creates a new GetStateEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns GetStateEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IGetStateEntryMessage): dev.restate.service.protocol.GetStateEntryMessage;

                    /**
                     * Encodes the specified GetStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.GetStateEntryMessage.verify|verify} messages.
                     * @param message GetStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IGetStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified GetStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.GetStateEntryMessage.verify|verify} messages.
                     * @param message GetStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IGetStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a GetStateEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns GetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.GetStateEntryMessage;

                    /**
                     * Decodes a GetStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns GetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.GetStateEntryMessage;

                    /**
                     * Verifies a GetStateEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a GetStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns GetStateEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.GetStateEntryMessage;

                    /**
                     * Creates a plain object from a GetStateEntryMessage message. Also converts values to other types if specified.
                     * @param message GetStateEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.GetStateEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this GetStateEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for GetStateEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a SetStateEntryMessage. */
                interface ISetStateEntryMessage {

                    /** SetStateEntryMessage key */
                    key?: (Uint8Array|null);

                    /** SetStateEntryMessage value */
                    value?: (Uint8Array|null);
                }

                /** Represents a SetStateEntryMessage. */
                class SetStateEntryMessage implements ISetStateEntryMessage {

                    /**
                     * Constructs a new SetStateEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.ISetStateEntryMessage);

                    /** SetStateEntryMessage key. */
                    public key: Uint8Array;

                    /** SetStateEntryMessage value. */
                    public value: Uint8Array;

                    /**
                     * Creates a new SetStateEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns SetStateEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.ISetStateEntryMessage): dev.restate.service.protocol.SetStateEntryMessage;

                    /**
                     * Encodes the specified SetStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.SetStateEntryMessage.verify|verify} messages.
                     * @param message SetStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.ISetStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified SetStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.SetStateEntryMessage.verify|verify} messages.
                     * @param message SetStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.ISetStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a SetStateEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns SetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.SetStateEntryMessage;

                    /**
                     * Decodes a SetStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns SetStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.SetStateEntryMessage;

                    /**
                     * Verifies a SetStateEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a SetStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns SetStateEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.SetStateEntryMessage;

                    /**
                     * Creates a plain object from a SetStateEntryMessage message. Also converts values to other types if specified.
                     * @param message SetStateEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.SetStateEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this SetStateEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for SetStateEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a ClearStateEntryMessage. */
                interface IClearStateEntryMessage {

                    /** ClearStateEntryMessage key */
                    key?: (Uint8Array|null);
                }

                /** Represents a ClearStateEntryMessage. */
                class ClearStateEntryMessage implements IClearStateEntryMessage {

                    /**
                     * Constructs a new ClearStateEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IClearStateEntryMessage);

                    /** ClearStateEntryMessage key. */
                    public key: Uint8Array;

                    /**
                     * Creates a new ClearStateEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns ClearStateEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IClearStateEntryMessage): dev.restate.service.protocol.ClearStateEntryMessage;

                    /**
                     * Encodes the specified ClearStateEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.ClearStateEntryMessage.verify|verify} messages.
                     * @param message ClearStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IClearStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified ClearStateEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.ClearStateEntryMessage.verify|verify} messages.
                     * @param message ClearStateEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IClearStateEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a ClearStateEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns ClearStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.ClearStateEntryMessage;

                    /**
                     * Decodes a ClearStateEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns ClearStateEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.ClearStateEntryMessage;

                    /**
                     * Verifies a ClearStateEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a ClearStateEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns ClearStateEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.ClearStateEntryMessage;

                    /**
                     * Creates a plain object from a ClearStateEntryMessage message. Also converts values to other types if specified.
                     * @param message ClearStateEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.ClearStateEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this ClearStateEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for ClearStateEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a SleepEntryMessage. */
                interface ISleepEntryMessage {

                    /** SleepEntryMessage wakeUpTime */
                    wakeUpTime?: (number|Long|null);

                    /** SleepEntryMessage result */
                    result?: (google.protobuf.IEmpty|null);
                }

                /** Represents a SleepEntryMessage. */
                class SleepEntryMessage implements ISleepEntryMessage {

                    /**
                     * Constructs a new SleepEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.ISleepEntryMessage);

                    /** SleepEntryMessage wakeUpTime. */
                    public wakeUpTime: (number|Long);

                    /** SleepEntryMessage result. */
                    public result?: (google.protobuf.IEmpty|null);

                    /**
                     * Creates a new SleepEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns SleepEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.ISleepEntryMessage): dev.restate.service.protocol.SleepEntryMessage;

                    /**
                     * Encodes the specified SleepEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.SleepEntryMessage.verify|verify} messages.
                     * @param message SleepEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.ISleepEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified SleepEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.SleepEntryMessage.verify|verify} messages.
                     * @param message SleepEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.ISleepEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a SleepEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns SleepEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.SleepEntryMessage;

                    /**
                     * Decodes a SleepEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns SleepEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.SleepEntryMessage;

                    /**
                     * Verifies a SleepEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a SleepEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns SleepEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.SleepEntryMessage;

                    /**
                     * Creates a plain object from a SleepEntryMessage message. Also converts values to other types if specified.
                     * @param message SleepEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.SleepEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this SleepEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for SleepEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of an InvokeEntryMessage. */
                interface IInvokeEntryMessage {

                    /** InvokeEntryMessage serviceName */
                    serviceName?: (string|null);

                    /** InvokeEntryMessage methodName */
                    methodName?: (string|null);

                    /** InvokeEntryMessage parameter */
                    parameter?: (Uint8Array|null);

                    /** InvokeEntryMessage value */
                    value?: (Uint8Array|null);

                    /** InvokeEntryMessage failure */
                    failure?: (dev.restate.service.protocol.IFailure|null);
                }

                /** Represents an InvokeEntryMessage. */
                class InvokeEntryMessage implements IInvokeEntryMessage {

                    /**
                     * Constructs a new InvokeEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IInvokeEntryMessage);

                    /** InvokeEntryMessage serviceName. */
                    public serviceName: string;

                    /** InvokeEntryMessage methodName. */
                    public methodName: string;

                    /** InvokeEntryMessage parameter. */
                    public parameter: Uint8Array;

                    /** InvokeEntryMessage value. */
                    public value?: (Uint8Array|null);

                    /** InvokeEntryMessage failure. */
                    public failure?: (dev.restate.service.protocol.IFailure|null);

                    /** InvokeEntryMessage result. */
                    public result?: ("value"|"failure");

                    /**
                     * Creates a new InvokeEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns InvokeEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IInvokeEntryMessage): dev.restate.service.protocol.InvokeEntryMessage;

                    /**
                     * Encodes the specified InvokeEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.InvokeEntryMessage.verify|verify} messages.
                     * @param message InvokeEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IInvokeEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified InvokeEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.InvokeEntryMessage.verify|verify} messages.
                     * @param message InvokeEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IInvokeEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes an InvokeEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns InvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.InvokeEntryMessage;

                    /**
                     * Decodes an InvokeEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns InvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.InvokeEntryMessage;

                    /**
                     * Verifies an InvokeEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates an InvokeEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns InvokeEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.InvokeEntryMessage;

                    /**
                     * Creates a plain object from an InvokeEntryMessage message. Also converts values to other types if specified.
                     * @param message InvokeEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.InvokeEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this InvokeEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for InvokeEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a BackgroundInvokeEntryMessage. */
                interface IBackgroundInvokeEntryMessage {

                    /** BackgroundInvokeEntryMessage serviceName */
                    serviceName?: (string|null);

                    /** BackgroundInvokeEntryMessage methodName */
                    methodName?: (string|null);

                    /** BackgroundInvokeEntryMessage parameter */
                    parameter?: (Uint8Array|null);
                }

                /** Represents a BackgroundInvokeEntryMessage. */
                class BackgroundInvokeEntryMessage implements IBackgroundInvokeEntryMessage {

                    /**
                     * Constructs a new BackgroundInvokeEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IBackgroundInvokeEntryMessage);

                    /** BackgroundInvokeEntryMessage serviceName. */
                    public serviceName: string;

                    /** BackgroundInvokeEntryMessage methodName. */
                    public methodName: string;

                    /** BackgroundInvokeEntryMessage parameter. */
                    public parameter: Uint8Array;

                    /**
                     * Creates a new BackgroundInvokeEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns BackgroundInvokeEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IBackgroundInvokeEntryMessage): dev.restate.service.protocol.BackgroundInvokeEntryMessage;

                    /**
                     * Encodes the specified BackgroundInvokeEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.BackgroundInvokeEntryMessage.verify|verify} messages.
                     * @param message BackgroundInvokeEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IBackgroundInvokeEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified BackgroundInvokeEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.BackgroundInvokeEntryMessage.verify|verify} messages.
                     * @param message BackgroundInvokeEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IBackgroundInvokeEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a BackgroundInvokeEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns BackgroundInvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.BackgroundInvokeEntryMessage;

                    /**
                     * Decodes a BackgroundInvokeEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns BackgroundInvokeEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.BackgroundInvokeEntryMessage;

                    /**
                     * Verifies a BackgroundInvokeEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a BackgroundInvokeEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns BackgroundInvokeEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.BackgroundInvokeEntryMessage;

                    /**
                     * Creates a plain object from a BackgroundInvokeEntryMessage message. Also converts values to other types if specified.
                     * @param message BackgroundInvokeEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.BackgroundInvokeEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this BackgroundInvokeEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for BackgroundInvokeEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of an AwakeableEntryMessage. */
                interface IAwakeableEntryMessage {

                    /** AwakeableEntryMessage value */
                    value?: (Uint8Array|null);

                    /** AwakeableEntryMessage failure */
                    failure?: (dev.restate.service.protocol.IFailure|null);
                }

                /** Represents an AwakeableEntryMessage. */
                class AwakeableEntryMessage implements IAwakeableEntryMessage {

                    /**
                     * Constructs a new AwakeableEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IAwakeableEntryMessage);

                    /** AwakeableEntryMessage value. */
                    public value?: (Uint8Array|null);

                    /** AwakeableEntryMessage failure. */
                    public failure?: (dev.restate.service.protocol.IFailure|null);

                    /** AwakeableEntryMessage result. */
                    public result?: ("value"|"failure");

                    /**
                     * Creates a new AwakeableEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns AwakeableEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IAwakeableEntryMessage): dev.restate.service.protocol.AwakeableEntryMessage;

                    /**
                     * Encodes the specified AwakeableEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.AwakeableEntryMessage.verify|verify} messages.
                     * @param message AwakeableEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IAwakeableEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified AwakeableEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.AwakeableEntryMessage.verify|verify} messages.
                     * @param message AwakeableEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IAwakeableEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes an AwakeableEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns AwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.AwakeableEntryMessage;

                    /**
                     * Decodes an AwakeableEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns AwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.AwakeableEntryMessage;

                    /**
                     * Verifies an AwakeableEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates an AwakeableEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns AwakeableEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.AwakeableEntryMessage;

                    /**
                     * Creates a plain object from an AwakeableEntryMessage message. Also converts values to other types if specified.
                     * @param message AwakeableEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.AwakeableEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this AwakeableEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for AwakeableEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a CompleteAwakeableEntryMessage. */
                interface ICompleteAwakeableEntryMessage {

                    /** CompleteAwakeableEntryMessage serviceName */
                    serviceName?: (string|null);

                    /** CompleteAwakeableEntryMessage instanceKey */
                    instanceKey?: (Uint8Array|null);

                    /** CompleteAwakeableEntryMessage invocationId */
                    invocationId?: (Uint8Array|null);

                    /** CompleteAwakeableEntryMessage entryIndex */
                    entryIndex?: (number|null);

                    /** CompleteAwakeableEntryMessage payload */
                    payload?: (Uint8Array|null);
                }

                /** Represents a CompleteAwakeableEntryMessage. */
                class CompleteAwakeableEntryMessage implements ICompleteAwakeableEntryMessage {

                    /**
                     * Constructs a new CompleteAwakeableEntryMessage.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.ICompleteAwakeableEntryMessage);

                    /** CompleteAwakeableEntryMessage serviceName. */
                    public serviceName: string;

                    /** CompleteAwakeableEntryMessage instanceKey. */
                    public instanceKey: Uint8Array;

                    /** CompleteAwakeableEntryMessage invocationId. */
                    public invocationId: Uint8Array;

                    /** CompleteAwakeableEntryMessage entryIndex. */
                    public entryIndex: number;

                    /** CompleteAwakeableEntryMessage payload. */
                    public payload: Uint8Array;

                    /**
                     * Creates a new CompleteAwakeableEntryMessage instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns CompleteAwakeableEntryMessage instance
                     */
                    public static create(properties?: dev.restate.service.protocol.ICompleteAwakeableEntryMessage): dev.restate.service.protocol.CompleteAwakeableEntryMessage;

                    /**
                     * Encodes the specified CompleteAwakeableEntryMessage message. Does not implicitly {@link dev.restate.service.protocol.CompleteAwakeableEntryMessage.verify|verify} messages.
                     * @param message CompleteAwakeableEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.ICompleteAwakeableEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified CompleteAwakeableEntryMessage message, length delimited. Does not implicitly {@link dev.restate.service.protocol.CompleteAwakeableEntryMessage.verify|verify} messages.
                     * @param message CompleteAwakeableEntryMessage message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.ICompleteAwakeableEntryMessage, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a CompleteAwakeableEntryMessage message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns CompleteAwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.CompleteAwakeableEntryMessage;

                    /**
                     * Decodes a CompleteAwakeableEntryMessage message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns CompleteAwakeableEntryMessage
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.CompleteAwakeableEntryMessage;

                    /**
                     * Verifies a CompleteAwakeableEntryMessage message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a CompleteAwakeableEntryMessage message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns CompleteAwakeableEntryMessage
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.CompleteAwakeableEntryMessage;

                    /**
                     * Creates a plain object from a CompleteAwakeableEntryMessage message. Also converts values to other types if specified.
                     * @param message CompleteAwakeableEntryMessage
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.CompleteAwakeableEntryMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this CompleteAwakeableEntryMessage to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for CompleteAwakeableEntryMessage
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }

                /** Properties of a Failure. */
                interface IFailure {

                    /** Failure code */
                    code?: (number|null);

                    /** Failure message */
                    message?: (string|null);
                }

                /** Represents a Failure. */
                class Failure implements IFailure {

                    /**
                     * Constructs a new Failure.
                     * @param [properties] Properties to set
                     */
                    constructor(properties?: dev.restate.service.protocol.IFailure);

                    /** Failure code. */
                    public code: number;

                    /** Failure message. */
                    public message: string;

                    /**
                     * Creates a new Failure instance using the specified properties.
                     * @param [properties] Properties to set
                     * @returns Failure instance
                     */
                    public static create(properties?: dev.restate.service.protocol.IFailure): dev.restate.service.protocol.Failure;

                    /**
                     * Encodes the specified Failure message. Does not implicitly {@link dev.restate.service.protocol.Failure.verify|verify} messages.
                     * @param message Failure message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encode(message: dev.restate.service.protocol.IFailure, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Encodes the specified Failure message, length delimited. Does not implicitly {@link dev.restate.service.protocol.Failure.verify|verify} messages.
                     * @param message Failure message or plain object to encode
                     * @param [writer] Writer to encode to
                     * @returns Writer
                     */
                    public static encodeDelimited(message: dev.restate.service.protocol.IFailure, writer?: $protobuf.Writer): $protobuf.Writer;

                    /**
                     * Decodes a Failure message from the specified reader or buffer.
                     * @param reader Reader or buffer to decode from
                     * @param [length] Message length if known beforehand
                     * @returns Failure
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): dev.restate.service.protocol.Failure;

                    /**
                     * Decodes a Failure message from the specified reader or buffer, length delimited.
                     * @param reader Reader or buffer to decode from
                     * @returns Failure
                     * @throws {Error} If the payload is not a reader or valid buffer
                     * @throws {$protobuf.util.ProtocolError} If required fields are missing
                     */
                    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): dev.restate.service.protocol.Failure;

                    /**
                     * Verifies a Failure message.
                     * @param message Plain object to verify
                     * @returns `null` if valid, otherwise the reason why it is not
                     */
                    public static verify(message: { [k: string]: any }): (string|null);

                    /**
                     * Creates a Failure message from a plain object. Also converts values to their respective internal types.
                     * @param object Plain object
                     * @returns Failure
                     */
                    public static fromObject(object: { [k: string]: any }): dev.restate.service.protocol.Failure;

                    /**
                     * Creates a plain object from a Failure message. Also converts values to other types if specified.
                     * @param message Failure
                     * @param [options] Conversion options
                     * @returns Plain object
                     */
                    public static toObject(message: dev.restate.service.protocol.Failure, options?: $protobuf.IConversionOptions): { [k: string]: any };

                    /**
                     * Converts this Failure to JSON.
                     * @returns JSON object
                     */
                    public toJSON(): { [k: string]: any };

                    /**
                     * Gets the default type url for Failure
                     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                     * @returns The default type url
                     */
                    public static getTypeUrl(typeUrlPrefix?: string): string;
                }
            }
        }
    }
}

/** Namespace google. */
export namespace google {

    /** Namespace protobuf. */
    namespace protobuf {

        /** Properties of an Empty. */
        interface IEmpty {
        }

        /** Represents an Empty. */
        class Empty implements IEmpty {

            /**
             * Constructs a new Empty.
             * @param [properties] Properties to set
             */
            constructor(properties?: google.protobuf.IEmpty);

            /**
             * Creates a new Empty instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Empty instance
             */
            public static create(properties?: google.protobuf.IEmpty): google.protobuf.Empty;

            /**
             * Encodes the specified Empty message. Does not implicitly {@link google.protobuf.Empty.verify|verify} messages.
             * @param message Empty message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: google.protobuf.IEmpty, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Empty message, length delimited. Does not implicitly {@link google.protobuf.Empty.verify|verify} messages.
             * @param message Empty message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: google.protobuf.IEmpty, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an Empty message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Empty
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): google.protobuf.Empty;

            /**
             * Decodes an Empty message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns Empty
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): google.protobuf.Empty;

            /**
             * Verifies an Empty message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an Empty message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Empty
             */
            public static fromObject(object: { [k: string]: any }): google.protobuf.Empty;

            /**
             * Creates a plain object from an Empty message. Also converts values to other types if specified.
             * @param message Empty
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: google.protobuf.Empty, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Empty to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Empty
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }
}
