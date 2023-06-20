import {protoMetadata, TestGreeter, TestRequest, TestResponse} from "../src/generated/proto/test";
import * as restate from "../src/public_api";
import {TestDriver} from "./testdriver";
import {
    clearStateMessage,
    completionMessage,
    getStateMessage,
    greetRequest,
    greetResponse,
    inputMessage,
    keyVal,
    outputMessage,
    setStateMessage,
    startMessage,
    suspensionMessage
} from "./protoutils";
import {ProtocolMode} from "../src/generated/proto/discovery";

class GetEmpty implements TestGreeter {
    async greet(request: TestRequest): Promise<TestResponse> {
        const ctx = restate.useContext(this);

        const stateIsEmpty = (await ctx.get<string>("STATE")) === null;

        return TestResponse.create({greeting: `${stateIsEmpty}`})
    }
}

const input = inputMessage(greetRequest("Two"));
const COMPLETE_STATE = false;

describe("GetEmpty", () => {
    it('handles complete state without key present', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetEmpty(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1, COMPLETE_STATE), input
            ],
            ProtocolMode.BIDI_STREAM
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE", undefined, true),
            outputMessage(greetResponse("true"))
        ])
    });

    it('handles partial state without key present ', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetEmpty(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1), input
            ],
            ProtocolMode.BIDI_STREAM
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE"),
            suspensionMessage([1])
        ])
    });

    it('handles replay of partial state', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetEmpty(),
            "/test.TestGreeter/Greet",
            [
                startMessage(2), input,
                getStateMessage("STATE", undefined, true)
            ],
            ProtocolMode.BIDI_STREAM,
        ).run()

        expect(result).toStrictEqual([
            outputMessage(greetResponse("true"))
        ])
    });
})

class Get implements TestGreeter {
    async greet(request: TestRequest): Promise<TestResponse> {
        const ctx = restate.useContext(this);

        const state = (await ctx.get<string>("STATE")) || "nothing";

        return TestResponse.create({greeting: state});
    }
}

describe("Get", () => {
    it('handles complete state with key present', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new Get(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1, COMPLETE_STATE, [keyVal("STATE", "One")]),
                input
            ],
            ProtocolMode.BIDI_STREAM,

        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE", "One"),
            outputMessage(greetResponse("One"))
        ])
    });

    it('handles partial state with key present ', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new Get(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1, undefined, [keyVal("STATE", "One")]), input
            ],
            ProtocolMode.BIDI_STREAM,

        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE", "One"),
            outputMessage(greetResponse("One"))
        ])
    });

    it('handles partial state without key present', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new Get(),
            "/test.TestGreeter/Greet",
            [
                startMessage(2), input
            ],
            ProtocolMode.BIDI_STREAM
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE"),
            suspensionMessage([1])
        ])
    });
})

class GetAppendAndGet implements TestGreeter {
    async greet(request: TestRequest): Promise<TestResponse> {
        const ctx = restate.useContext(this);

        const oldState = await ctx.get<string>("STATE") || "nothing";
        ctx.set("STATE", oldState + request.name);
        const newState = await ctx.get<string>("STATE") || "nothing";

        return TestResponse.create({greeting: newState});
    }
}

describe("GetAppendAndGet", () => {
    it('handles complete state with key present', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetAppendAndGet(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1,
                  COMPLETE_STATE,
                  [keyVal("STATE", "One")]), input
            ],
            ProtocolMode.BIDI_STREAM,

        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE", "One"),
            setStateMessage("STATE", "OneTwo"),
            getStateMessage("STATE", "OneTwo"),
            outputMessage(greetResponse("OneTwo"))
        ])
    });

    it('handles partial state with key not present ', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetAppendAndGet(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1), input,
                completionMessage(1, JSON.stringify("One"))
            ],
            ProtocolMode.BIDI_STREAM
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE"),
            setStateMessage("STATE", "OneTwo"),
            getStateMessage("STATE", "OneTwo"),
            outputMessage(greetResponse("OneTwo"))
        ])
    });
})

class GetClearAndGet implements TestGreeter {
    async greet(request: TestRequest): Promise<TestResponse> {
        const ctx = restate.useContext(this);

        const oldState = (await ctx.get<string>("STATE")) || "not-nothing";
        ctx.clear("STATE");
        const newState = (await ctx.get<string>("STATE")) || "nothing";

        return TestResponse.create({greeting: `${oldState}-${newState}`});
    }
}

describe("GetClearAndGet", () => {
    it('handles complete state with key present', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetClearAndGet(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1, COMPLETE_STATE, [keyVal("STATE", "One")]),
                input
            ],
            ProtocolMode.BIDI_STREAM
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE", "One"),
            clearStateMessage("STATE"),
            getStateMessage("STATE", undefined, true),
            outputMessage(greetResponse("One-nothing"))
        ])
    });

    it('handles partial state with key not present ', async () => {
        const result = await new TestDriver(
            protoMetadata,
            "TestGreeter",
            new GetClearAndGet(),
            "/test.TestGreeter/Greet",
            [
                startMessage(1), input,
                completionMessage(1, JSON.stringify("One"))
            ],
            ProtocolMode.BIDI_STREAM,
        ).run()

        expect(result).toStrictEqual([
            getStateMessage("STATE"),
            clearStateMessage("STATE"),
            getStateMessage("STATE", undefined, true),
            outputMessage(greetResponse("One-nothing"))
        ])
    });
})
