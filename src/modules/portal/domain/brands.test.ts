import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalBrandAllowed } from './portal.ts';

test('trang khách chỉ hiện Minh Long, Minh Long I, Minh Long - LYS, LYS, Lock&Lock, Healthy Cook / Sứ dưỡng sinh', () => {
  for (const b of ['Minh Long', 'MINH LONG', 'Minh Long I', 'MINH LONG - LYS', 'Minh Long LYS', 'LYS', 'Lock', 'Lock&Lock', 'LocknLock', 'Lock & Lock', 'Healthy Cook', 'HEALTHYCOOK', 'Sứ dưỡng sinh', 'SỨ DƯỠNG SINH'])
    assert.equal(portalBrandAllowed(b), true, b);
  for (const b of ['Khác', '', null, 'Minh Long II', 'Lock&Lock Vina', 'Gốm Bát Tràng']) assert.equal(portalBrandAllowed(b), false, String(b));
});
