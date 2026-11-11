/** Serialize an autocomplete's reads. While one is pending, keep only the latest
 * requested search; stale callers still settle and their existing sequence guard
 * discards the result. No caching, cancellation of server work, or write retries.
 */
export function createLatestRead() {
  let active = false, waiting = null;
  async function drain(entry) {
    active = true;
    try {
      const value = await entry.work();
      for (const waiter of entry.waiters) waiter.resolve(value);
    } catch (error) {
      for (const waiter of entry.waiters) waiter.reject(error);
    } finally {
      const next = waiting;
      waiting = null;
      if (next) drain(next);
      else active = false;
    }
  }
  return work => new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    if (!active) drain({ work, waiters: [waiter] });
    else if (waiting) { waiting.work = work; waiting.waiters.push(waiter); }
    else waiting = { work, waiters: [waiter] };
  });
}
