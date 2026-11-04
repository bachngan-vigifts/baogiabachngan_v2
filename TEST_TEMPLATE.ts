/**
 * Vitest unit test structure (tests/unit/<feature>.spec.ts):
 *
 * import { describe, expect, it, vi } from 'vitest';
 *
 * describe('business operation', () => {
 *   it('success: returns the result', async () => {
 *     // Arrange: create input/dependencies.
 *     // Act: await the operation.
 *     // Assert: verify output and side effects exactly once.
 *   });
 *   it('not found / edge: rejects without writes', async () => {
 *     // Arrange missing/boundary data; assert rejection and no writes.
 *   });
 *   it('exception: propagates failure without partial writes', async () => {
 *     // Inject a rejected dependency with vi.fn().mockRejectedValue(...).
 *     // Verify rollback, then retry the same idempotency key safely.
 *   });
 * });
 *
 * Database/transaction contracts also belong in tests/app using the existing
 * node:test + PGlite fixtures. Keep production services out of all unit tests.
 */
export {};
