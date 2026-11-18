import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('floating chat panel exposes a direct Chat cùng AI shortcut', async () => {
  const [html, js] = await Promise.all([
    readFile(new URL('../../trial-ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../trial-ui/chat.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="chat-ai-shortcut"[^>]+href="#\/ai-chat"/);
  assert.match(html, /<b>Chat cùng AI<\/b>/);
  assert.match(js, /q\('#chat-ai-shortcut'\)\.addEventListener\('click', hide\)/);
});
