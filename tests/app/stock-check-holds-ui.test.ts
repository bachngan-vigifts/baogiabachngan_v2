import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { quoteStockSku } from '../../src/modules/quotes/domain/quote-math.ts';

interface Hold {
  sku: string;
  qty: number;
  quoteId: string;
  quoteNo?: string;
  orderId?: string;
  orderNo?: string;
  contractNo?: string;
}
const app = readFileSync(
  new URL('../../trial-ui/app.js', import.meta.url),
  'utf8',
);
const start = app.indexOf("$('#quote-stock').addEventListener('click'");
const handler = app.slice(start, app.indexOf('\n});', start) + 4);
const helpers = app.slice(
  app.indexOf('let holdsAt = 0, holdsReq = null;'),
  app.indexOf('const stockDetail ='),
);

async function render({
  holds = [],
  need = 5,
  fail = false,
  missingProduct = false,
}: {
  holds?: Hold[];
  need?: number;
  fail?: boolean;
  missingProduct?: boolean;
} = {}) {
  const nodes = new Map<
    string,
    {
      innerHTML: string;
      textContent: string;
      showModal(): void;
      addEventListener(event: string, fn: () => Promise<void>): void;
    }
  >();
  let click!: () => Promise<void>;
  const $ = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, {
        innerHTML: '',
        textContent: '',
        showModal() {},
        addEventListener(_event, fn) {
          click = fn;
        },
      });
    return nodes.get(id)!;
  };
  const state = {
    warehouses: [{ id: 'vig', kind: 'stock' }],
    holds: new Map<string, Hold[]>(),
    holdsLoaded: false,
  };
  const ctx = {
    $,
    state,
    editor: { id: 'q-own' },
    quoteStockSku,
    collectQuote: () => ({
      quoteNo: 'BG-TEST',
      rows: [{ sku: 'TEA', name: 'Bộ trà', unit: 'bộ', qty: need }],
    }),
    api: async (path: string) => {
      if (path === '/stock-holds') {
        if (fail) throw Error('Offline');
        return { holds };
      }
      return {
        products: missingProduct ? [] : [{ sku: 'TEA', stock: { vig: 10 } }],
      };
    },
    applyCatalogMeta() {},
    bindStockCheckFilter() {},
    toast() {},
    hasSupplierStock: () => false,
    incomingCell: () => '0',
    fmtNum: (n: number) => String(n),
    esc: (s: unknown) => String(s ?? '').replaceAll('<', '&lt;'),
    docHref: (id: string, no?: string) =>
      '#/' + (no ? 'contracts/' : 'orders/') + id,
  };
  runInNewContext(helpers + handler, ctx);
  if (fail) {
    state.holdsLoaded = true;
    state.holds.set('TEA', [{ sku: 'TEA', qty: 1, quoteId: 'old' }]);
  }
  await click();
  return {
    html: $('#stock-check-body').innerHTML,
    note: $('#stock-check-note').textContent,
  };
}

test('Kiểm tồn luôn có cột Hàng đang giữ kể cả khi bằng 0', async () => {
  const d = await render();
  assert.match(d.html, /<th[^>]*>Hàng đang giữ<\/th>/);
  assert.match(d.html, /<td class="right">10<\/td><td class="right">0<\/td>/);
  assert.match(d.html, /data-stock-result="enough"/);
});

test('cột giữ gộp báo giá và HĐKT đúng một lần; phần chính báo giá giữ vẫn dùng được', async () => {
  const d = await render({
    need: 8,
    holds: [
      { sku: 'TEA', qty: 3, quoteId: 'q-own', quoteNo: 'BG-OWN' },
      {
        sku: 'TEA',
        qty: 4,
        quoteId: 'q-contract',
        orderId: 'order-contract',
        orderNo: 'DH-HIDDEN',
        contractNo: 'HD-TEST',
      },
    ],
  });
  assert.match(d.html, /<td class="right">7<small>/);
  assert.match(d.html, /báo giá này đang giữ 3/);
  assert.match(d.html, /href="#\/contracts\/order-contract"/);
  assert.match(d.html, /Thiếu 2/);
  assert.match(d.note, /phần báo giá này đang giữ vẫn dùng được/);
});

test('lỗi tải giữ hàng hoặc thiếu sản phẩm không bị coi là giữ 0 / đủ hàng', async () => {
  const failed = await render({ fail: true });
  assert.match(failed.html, /Chưa tải được/);
  assert.match(failed.html, /data-stock-result="unknown"/);
  assert.doesNotMatch(failed.html, /data-stock-result="enough"/);
  assert.match(failed.note, /chưa thể kết luận đủ hàng/);
  const missing = await render({ missingProduct: true });
  assert.match(missing.html, /data-stock-result="unknown"/);
  assert.match(missing.html, /Không có số liệu/);
});
