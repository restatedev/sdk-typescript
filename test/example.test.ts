import {describe, expect} from '@jest/globals'

describe('ExampleTest', () => {
    it('Should demonstrate how to use a test', () => {

        expect("hello").toStrictEqual("hello");
    });

    it('Should show another test', () => {
        expect("world").toStrictEqual("world");
    });

});
