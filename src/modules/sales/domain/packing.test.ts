import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packingSuggestion } from './packing.ts';

test('gợi ý đóng gói: thùng chẵn + lẻ, kích thước, cân nặng theo tỷ lệ; thiếu số liệu thì để trống', () => {
  const s = packingSuggestion(50, 'cái', { perCarton: 24, cartonWeight: 12, cartonLength: 60, cartonWidth: 40, cartonHeight: 30 });
  assert.deepEqual([s.cartons, s.loose, s.weight, s.cartonSize, s.text], [2, 2, 25, '60×40×30 cm', '2 thùng × 24 cái + 2 cái lẻ']);
  assert.equal(packingSuggestion(48, 'cái', { perCarton: 24 }).text, '2 thùng × 24 cái');
  assert.deepEqual([packingSuggestion(5, 'bộ', null).text, packingSuggestion(5, 'bộ', null).weight], ['', null]);
});
