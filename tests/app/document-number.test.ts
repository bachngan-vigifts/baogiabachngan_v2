import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentDate, documentNumberPatterns, documentSequence, nextDocumentNumber } from '../../src/core/document-number.ts';
import { autoQuoteHead, nextQuoteNoAfter } from '../../src/modules/quotes/domain/quote-number.ts';
import { posQrOrderNumbers } from '../../src/modules/sales/domain/pos-qr-reference.ts';
test('document format: five document kinds, day-first date and mixed-format counters', () => {
  for (const prefix of ['DH','POS','GH','DG','HRC_BG','B2B_BG','VG_BG']) {
    const legacy = prefix.endsWith('_BG') ? prefix + '20261022_' : prefix + '_20261022_';
    assert.equal(nextDocumentNumber(prefix, '2026-10-22', [], legacy), `${prefix}_001_22102026`);
    assert.equal(nextDocumentNumber(prefix, '2026-10-22', [legacy+'007', `${prefix}_009_22102026`, `${prefix}_888_21102026`, `${prefix}_999_22102026x`, 'OTHER_999_22102026'], legacy), `${prefix}_010_22102026`);
    assert.equal(nextDocumentNumber(prefix, '2026-10-23', [`${prefix}_999_22102026`]), `${prefix}_001_23102026`);
  }
  assert.equal(nextDocumentNumber('POS', '2026-10-22', ['POS_999_22102026']), 'POS_1000_22102026');
  assert.equal(documentSequence('POS_1000_22102026', 'POS', '2026-10-22'), 1000);
  assert.equal(documentDate('2028-02-29'), '29022028');
  assert.throws(() => documentDate('2026-02-29')); assert.throws(() => documentDate('2026-13-01'));
  assert.equal(autoQuoteHead('VG_BG_003_22102026'), 'VG_BG20261022_');
  assert.equal(nextQuoteNoAfter('VG_BG20261022_', ['VG_BG20261022_002']), 'VG_BG_003_22102026');
  assert.ok(posQrOrderNumbers('THANHTOANDONPOS00322102026').includes('POS_003_22102026'));
  assert.ok(posQrOrderNumbers('THANHTOANDONPOS20261022003').includes('POS_20261022_003'));
  assert.equal(documentNumberPatterns('DH', '2026-10-22')[0], 'DH\\_%\\_22102026');
});
