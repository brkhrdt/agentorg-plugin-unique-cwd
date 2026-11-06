import assert from "node:assert/strict";
export { afterEach, test } from "node:test";
export function expect(actual: any) {
  return {
    toBe(expected: any) { assert.equal(actual, expected); },
    toContain(expected: any) { assert.ok(actual?.includes(expected)); },
    toMatchObject(expected: any) { for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual?.[key], value); },
    get not() { return { toBe(expected: any) { assert.notEqual(actual, expected); } }; },
  };
}
