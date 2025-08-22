import { describe, expect, it } from "vitest";
import * as z3 from "zod/v3";
import * as z4 from "zod/v4";
import { serde } from "../src/serde_api.js";
import { zodToJsonSchema } from "zod-to-json-schema";

const validData = {
    id: 1,
    name: "test",
    isActive: true,
}
const validDataSerialized = new TextEncoder().encode(JSON.stringify(validData));
const invalidData = {
    id: -1, // not positive
    name: "a", // less than 3 characters
    isActive: "not a boolean",
}
const invalidDataSerialized = new TextEncoder().encode(JSON.stringify(invalidData));


const z3Schema = z3.object({
    id: z3.number().int().positive(),
    name: z3.string().min(3, { message: "Name must be at least 3 characters long" }),
    isActive: z3.boolean(),
});
const z3Serde = serde.zod(z3Schema);
const z3JsonSchema = zodToJsonSchema(z3Schema as never);

const z4Schema = z4.object({
    id: z4.number().int().positive(),
    name: z4.string().min(3, { message: "Name must be at least 3 characters long" }),
    isActive: z4.boolean(),
});
const z4Serde = serde.zod(z4Schema);
const z4JsonSchema = z4.toJSONSchema(z4Schema);

describe('serde_api', () => {
    describe.each([
        {ver: 'v3', srd: z3Serde, jsonSchema: z3JsonSchema},
        {ver: 'v4', srd: z4Serde, jsonSchema: z4JsonSchema},
    ])("zod $ver", ({ srd, jsonSchema }) => {
        describe('constructor', () => {
            it('converts a valid schema to json', () => {
                expect(srd.jsonSchema).not.to.be.null;
                expect(srd.jsonSchema).to.deep.equal(jsonSchema);
            });
        })
        describe('serialize', () => {
            it('serializes a valid object', () => {
                expect(srd.serialize(validData)).to.deep.equal(validDataSerialized);
            });
            it('gives an empty response for undefined', () => {
                expect(srd.serialize(undefined)).to.be.empty;
            })
        })
        describe('deserialize', () => {
            it('deserializes a valid object', () => {
                expect(srd.deserialize(validDataSerialized)).to.deep.equal(validData);
            });
            it('throws an error on an invalid object', () => {
                expect(() => srd.deserialize(invalidDataSerialized)).throws();
            });
        });
    });
});