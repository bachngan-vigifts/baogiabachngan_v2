import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AI answer polling preserves the active question draft and cursor', async () => {
  const js = await readFile(new URL('../../trial-ui/ai-chat.js', import.meta.url), 'utf8');

  assert.match(js, /value:currentEditor\.value/);
  assert.match(js, /focused:document\.activeElement===currentEditor/);
  assert.match(js, /nextEditor\.value=draft\.value/);
  assert.match(js, /nextEditor\.focus\(\{preventScroll:true\}\)/);
  assert.match(js, /nextEditor\.setSelectionRange\(draft\.start,draft\.end/);
});
