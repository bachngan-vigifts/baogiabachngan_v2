/** Copy into a *.test.ts file; use node:test and strict assertions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

export function contractTest(name: string, run: () => void | Promise<void>) {
  test(name, run);
}
export { assert };
// Arrange fixtures → Act on public API/function → Assert behavior and error cases.
// DB tests use helpers/postgres.ts (migrations + automatic cleanup).
