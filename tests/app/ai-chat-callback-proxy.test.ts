import test from 'node:test';
import assert from 'node:assert/strict';
// Cloudflare Pages loads this JavaScript function directly; the test supplies its typed context below.
// @ts-expect-error JavaScript Pages Function intentionally has no generated declaration file.
import { onRequestPost } from '../../functions/api/staff/integrations/ai-chat/[id]/result.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const token = '123e4567-e89b-42d3-a456-426614174001';

test('AI Chat callback bridge forwards only the one-time callback contract', async () => {
  let seen: { url?: string; init?: RequestInit } = {};
  const response = await onRequestPost({
    request: new Request(`https://crm.minhlongonline.com/api/staff/integrations/ai-chat/${id}/result`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', cookie: 'private=drop-me' }, body: JSON.stringify({ status: 'answered', answer: 'Đã rõ.' }),
    }),
    params: { id },
    env: { AI_CHAT_UPSTREAM_FETCH: async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ ok: true });
    } },
  });
  assert.equal(response.status, 200);
  assert.equal(seen.url, `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/ai-chat/${id}/result`);
  const headers = new Headers(seen.init?.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.has('cookie'), false);
});

test('AI Chat callback bridge rejects malformed identity or authorization before forwarding', async () => {
  let calls = 0;
  const env = { AI_CHAT_UPSTREAM_FETCH: async () => { calls++; return Response.json({ ok: true }); } };
  const badId = await onRequestPost({ request: new Request('https://crm.minhlongonline.com/x', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }), params: { id: '../x' }, env });
  const badAuth = await onRequestPost({ request: new Request('https://crm.minhlongonline.com/x', { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: '{}' }), params: { id }, env });
  assert.equal(badId.status, 400);
  assert.equal(badAuth.status, 401);
  assert.equal(calls, 0);
});
