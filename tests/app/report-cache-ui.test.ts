import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import { cacheText, cacheLineHtml } from '../../trial-ui/report-cache.js';

test('Dòng "Số liệu lúc": giờ VN, phút còn lại, vừa tính / tính sẵn, thiếu bảng cache thì không hứa tự làm mới', () => {
  const now = Date.parse('2026-11-07T07:20:00Z'); // 14:20 VN
  const cache = { computedAt: '2026-11-07T07:05:00.000Z', expiresAt: '2026-11-07T07:35:00.000Z', hit: true, available: true };
  assert.equal(cacheText(cache, now), 'Số liệu lúc 14:05 · tính sẵn, tự làm mới sau 15 phút');
  assert.equal(cacheText({ ...cache, hit: false }, now), 'Số liệu lúc 14:05 · vừa tính');
  assert.equal(cacheText({ ...cache, available: false }, now), 'Số liệu lúc 14:05');
  assert.equal(cacheText({ ...cache, computedAt: '2026-11-06T16:30:00.000Z' }, now), 'Số liệu lúc 23:30 06/11/2026 · tính sẵn, tự làm mới sau 15 phút');
  assert.equal(cacheText(undefined, now), '');
  const esc = (s: string) => s.replace(/</g, '&lt;');
  assert.match(cacheLineHtml(cache, 'pf-refresh', esc), /id="pf-refresh"[^>]*>⟳ Cập nhật</);
  assert.equal(cacheLineHtml(undefined, 'pf-refresh', esc), '');
});
