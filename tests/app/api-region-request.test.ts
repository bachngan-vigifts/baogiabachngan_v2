import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createRegionCanary, requestWithRegion } = await import(
  new URL('../../trial-ui/api-region.js', import.meta.url).href
);

const storage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
};
const newCanary = () => {
  const store = storage();
  return createRegionCanary({ storage: () => store });
};
type Policy = { readRetries: number; timeoutMs: number } | undefined;
test('regional reads have one bounded attempt, then fallback only on network or gateway failures', async () => {
  for (const failure of ['network', 502, 503, 504]) {
    const canary = newCanary();
    const calls: { headers: Record<string, string>; policy: Policy }[] = [];
    const result = await requestWithRegion(
      canary,
      async (headers: Record<string, string>, policy: Policy) => {
        calls.push({ headers, policy });
        if (calls.length === 1) {
          if (failure === 'network') throw Error('network');
          return new Response('{}', { status: Number(failure) });
        }
        return Response.json({ ok: true });
      },
    );
    assert.deepEqual(await result.json(), { ok: true });
    assert.deepEqual(calls, [
      {
        headers: { 'x-region': 'ap-northeast-2' },
        policy: { readRetries: 0, timeoutMs: 8000 },
      },
      { headers: {}, policy: undefined },
    ]);
    assert.equal(canary.enabled(), false);
  }
});
test('successful reads and permanent errors are returned once; fallback failures propagate', async () => {
  for (const status of [200, 400, 401, 403, 404, 409, 500]) {
    let calls = 0;
    const canary = newCanary();
    const result = await requestWithRegion(canary, async () => {
      calls++;
      return new Response('{}', {
        status,
        headers: { 'server-timing': 'region;desc="ap-northeast-2"' },
      });
    });
    assert.equal(calls, 1);
    assert.equal(result.status, status);
    assert.equal(canary.enabled(), true);
  }
  let calls = 0;
  await assert.rejects(
    requestWithRegion(newCanary(), async () => {
      calls++;
      throw Error('offline');
    }),
    /offline/,
  );
  assert.equal(calls, 2);
  const manual = newCanary();
  manual.disable();
  calls = 0;
  await assert.rejects(
    requestWithRegion(manual, async () => {
      calls++;
      throw Error('offline');
    }),
    /offline/,
  );
  assert.equal(calls, 1);
});
test('a write is never replayed to another region, even after 503 or an unknown outcome', async () => {
  for (const failure of ['network', 503]) {
    const canary = newCanary();
    let calls = 0;
    const send = async (_headers: Record<string, string>, policy: Policy) => {
      calls++;
      assert.equal(policy, undefined);
      if (failure === 'network') throw Error('unknown outcome');
      return new Response('{}', { status: 503 });
    };
    if (failure === 'network')
      await assert.rejects(
        requestWithRegion(canary, send, { read: false }),
        /unknown outcome/,
      );
    else
      assert.equal(
        (await requestWithRegion(canary, send, { read: false })).status,
        503,
      );
    assert.equal(calls, 1);
  }
});

const ours = (status: number, extra: Record<string, string> = {}) => new Response('{}', { status, headers: { 'server-timing': 'total;dur=5, region;desc="ap-northeast-2"', ...extra } });
test('503 của chính máy chủ mình ở đúng vùng (CSDL bận) không phải lỗi vùng: đọc thử lại tại chỗ, giữ máy chủ cạnh CSDL', async () => {
  const canary = newCanary(); const calls: Record<string, string>[] = []; const waits: number[] = [];
  const result = await requestWithRegion(canary, async (headers: Record<string, string>) => {
    calls.push(headers); return calls.length === 1 ? ours(503, { 'retry-after': '1' }) : ours(200);
  }, { delay: async (ms: number) => { waits.push(ms); } });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [{ 'x-region': 'ap-northeast-2' }, { 'x-region': 'ap-northeast-2' }], 'không chuyển sang máy chủ dự phòng');
  assert.deepEqual(waits, [1000], 'theo retry-after');
  assert.equal(canary.enabled(), true);
  // Vẫn bận ở lượt thử lại: trả 503 cho màn hình, vẫn giữ vùng.
  let n = 0;
  const busy = await requestWithRegion(canary, async () => { n++; return ours(503); }, { delay: async () => {} });
  assert.equal(busy.status, 503); assert.equal(n, 2); assert.equal(canary.enabled(), true);
  // Lượt thử lại gặp lỗi cổng (không phải máy chủ mình): tắt tạm, chuyển dự phòng.
  const seen: Record<string, string>[] = [];
  const fell = await requestWithRegion(canary, async (h: Record<string, string>) => { seen.push(h); return seen.length === 1 ? ours(503) : seen.length === 2 ? new Response('{}', { status: 502 }) : Response.json({ ok: true }); }, { delay: async () => {} });
  assert.equal(fell.status, 200); assert.deepEqual(seen.at(-1), {}); assert.equal(canary.enabled(), false);
});
test('lệnh ghi gặp 503 của máy chủ mình: không gửi lại, không tắt vùng', async () => {
  const canary = newCanary(); let calls = 0;
  const r = await requestWithRegion(canary, async () => { calls++; return ours(503); }, { read: false, delay: async () => {} });
  assert.equal(r.status, 503); assert.equal(calls, 1); assert.equal(canary.enabled(), true);
});
