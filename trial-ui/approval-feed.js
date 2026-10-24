/** One in-memory approval snapshot for the bell and inbox. Never persists staff data to disk. */
export function createApprovalFeed({ api, userId, canApprove, now = Date.now }) {
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  let owner, data = null, loadedAt = 0, pending = null, generation = 0;
  function clear() { generation++; data = null; loadedAt = 0; pending = null; owner = undefined; }
  function scoped() {
    const who = canApprove() ? userId() : null;
    if (who !== owner) { clear(); owner = who; }
    return who;
  }
  function peek() { return scoped() ? data : null; }
  function invalidate() { generation++; loadedAt = 0; pending = null; }
  function load({ force = false } = {}) {
    if (!scoped()) return Promise.resolve(null);
    if (pending) return pending;
    if (!force && data && now() - loadedAt < 30000) return Promise.resolve(data);
    const version = generation, who = owner;
    const request = Promise.resolve().then(() => api('/approvals')).then(result => {
      if (version !== generation || who !== userId() || !canApprove()) return null;
      data = result; loadedAt = now(); emit(); return data;
    }).catch(error => { if (version === generation && error.status === 403) clear(); throw error; }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  }
  return { peek, load, clear, invalidate, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
