/** A fixed number of workers; output follows input order and rejection drains all workers. */
export async function boundedMap<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid concurrency');
  const result: R[] = []; let next = 0, failed = false, error: unknown;
  async function worker() {
    while (!failed) {
      const i = next++; if (i >= items.length) return;
      try { result[i] = await fn(items[i]!, i); } catch (e) { failed = true; error = e; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw error;
  return result;
}
