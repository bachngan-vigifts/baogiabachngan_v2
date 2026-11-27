// Local browser regression; all API responses are fixtures, no real transactions.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/testing/sepay-ghn-allocation-ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../../trial-ui/sepay-allocations.js', import.meta.url));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/module.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/module.js' ? source : '<div id="root"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  async function setup({ hint = 5000, bank = 95000, history = [] } = {}) {
    await page.evaluate(async ({ hint, bank, history }) => {
      window.ui?.close(); sessionStorage.clear(); window.sent = [];
      const summary = { amount: bank, allocated: 0, remaining: bank, revision: 0, allocations: history };
      const candidate = { targetId: 'pos-1', orderNo: 'POS-1', customerName: 'Fixture', total: 100000, paid: 100000, outstanding: 0, ghnCode: 'GHN-1', ghnFeeHint: hint, existingPayments: [{ id: 'cod', source: 'ghn_cod', amount: 100000 }, { id: 'ordinary', source: 'manual', amount: 95000 }] };
      const api = async (path, method, body) => {
        if (method) { window.sent.push(body); return {}; }
        if (path === '/me') return { user: { id: 'fixture' } };
        if (path.includes('allocation-candidates')) return { candidates: [candidate], hasMore: false };
        if (path.endsWith('/allocations')) return summary;
        return { transaction: { content: 'Fixture only' } };
      };
      const { initSepayAllocations } = await import('/module.js');
      window.ui = initSepayAllocations({ api, root: document.querySelector('#root'), go() {} });
      await window.ui.show('fixture');
    }, { hint, bank, history });
  }
  await setup();
  await page.locator('[data-add]').click();
  await page.locator('[data-receipt]').selectOption('cod');
  assert.equal(await page.locator('[data-amount]').inputValue(), '95000');
  assert.equal(await page.locator('[data-ghn-fee]').inputValue(), '5000');
  assert.equal(await page.locator('[data-review]').isEnabled(), true);
  await page.locator('[data-review]').click();
  assert.match(await page.locator('.sa-review').innerText(), /Giữ nguyên phiếu khách đã trả COD/);
  await page.locator('[data-verified]').check();
  await page.locator('[data-confirm]').click();
  const payload = await page.evaluate(() => window.sent[0].lines[0]);
  assert.deepEqual(payload, { targetId: 'pos-1', amount: 95000, expectedAmount: 100000, ghnFee: 5000, differenceConfirmed: true, existingPaymentId: 'cod', paymentReviewed: false });
  // Switching to an ordinary receipt clears the GHN fee; deselection cannot submit.
  await page.locator('[data-add]').click();
  await page.locator('[data-receipt]').selectOption('cod');
  await page.locator('[data-receipt]').selectOption('ordinary');
  assert.equal(await page.locator('[data-ghn-fee]').inputValue(), '');
  assert.equal(await page.locator('[data-review]').isEnabled(), true);
  await page.locator('[data-receipt]').selectOption('');
  assert.equal(await page.locator('[data-amount]').inputValue(), '');
  assert.equal(await page.locator('[data-review]').isEnabled(), false);
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bn-sepay-allocation:fixture:fixture')).lines[0]);
  assert.equal(draft.expectedAmount, 0);
  await setup({ hint: 0, bank: 100000 });
  await page.locator('[data-add]').click();
  await page.locator('[data-receipt]').selectOption('cod');
  assert.equal(await page.locator('[data-review]').isEnabled(), true);
  await page.locator('[data-review]').click();
  await page.locator('[data-verified]').check();
  await page.locator('[data-confirm]').click();
  assert.equal(await page.evaluate(() => window.sent[0].lines[0].expectedAmount), 100000);
  await setup({ history: [
    { targetNo: 'SHORT', expectedAmount: 100000, amount: 90000, ghnFee: 5000, difference: -5000 },
    { targetNo: 'FULL', expectedAmount: 100000, amount: 95000, ghnFee: 5000, difference: 0 },
    { targetNo: 'OVER', expectedAmount: 100000, amount: 100000, ghnFee: 5000, difference: 5000 },
    { targetNo: 'ORDINARY', expectedAmount: 100000, amount: 90000, ghnFee: 0, difference: -10000 },
  ] });
  const rows = await page.locator('.sa-history').allTextContents();
  assert.match(rows[0], /Chênh thiếu 5\.000/);
  assert.doesNotMatch(rows[1], /Chênh/);
  assert.match(rows[2], /Chênh dư 5\.000/);
  assert.match(rows[3], /Chênh thiếu 10\.000/);
  assert.match(await page.locator('.muted').innerText(), /không ghi thêm tiền thu/);
  console.log('PASS: GHN select → review → fixture POST, ordinary/deselect/zero fee, history shortage/full/overage/no fee');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
