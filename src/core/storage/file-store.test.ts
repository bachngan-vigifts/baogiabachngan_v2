import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseFileStore } from './file-store.ts';

test('kho file Supabase: tải lên, ký link theo lô, xoá; chặn đường dẫn lạ', async () => {
  const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, auth: new Headers(init.headers).get('authorization') });
    if (url.endsWith('/object/sign/b')) return new Response(JSON.stringify([{ path: 'chat/a/1.pdf', signedURL: '/object/sign/b/chat/a/1.pdf?token=t' }, { path: 'x', error: 'no' }]));
    return new Response('{}');
  }) as unknown as typeof fetch;
  const s = supabaseFileStore({ url: 'https://p.supabase.co/', serviceKey: 'k', bucket: 'b', fetch: fake });
  await s.put('chat/a/1.pdf', new TextEncoder().encode('%PDF-1.4'), 'application/pdf');
  assert.deepEqual([calls[0]!.url, calls[0]!.method, calls[0]!.auth], ['https://p.supabase.co/storage/v1/object/b/chat/a/1.pdf', 'POST', 'Bearer k']);
  const urls = await s.signedUrls(['chat/a/1.pdf', 'x'], 60);
  assert.deepEqual([...urls], [['chat/a/1.pdf', 'https://p.supabase.co/storage/v1/object/sign/b/chat/a/1.pdf?token=t']]);
  assert.deepEqual(calls[1]!.body, { expiresIn: 60, paths: ['chat/a/1.pdf', 'x'] });
  await s.remove(['chat/a/1.pdf']); assert.deepEqual([calls[2]!.method, calls[2]!.body], ['DELETE', { prefixes: ['chat/a/1.pdf'] }]);
  await assert.rejects(s.put('../etc/passwd', new Uint8Array([1]), 'text/plain'), /không hợp lệ/);
});
