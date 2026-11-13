import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setupEarly } from './helpers/purchase-early-fixture.ts';
// @ts-expect-error browser module, intentionally shared parser
import { parseAccountingRows } from '../trial-ui/accounting-file.js';

test('SKU/SL parser preserves text codes, rejects invalid/duplicate rows and oversize without truncation', () => {
  assert.deepEqual(parseAccountingRows([['SKU', 'SL'], ['00123', '1.125']]), [{ sku: '00123', quantity: 1.125 }]);
  for (const rows of [
    [['SKU', 'SL'], ['X', '']], [['SKU', 'SL'], ['X', '0']],
    [['SKU', 'SL'], ['X', '1,000']], [['SKU', 'SL'], ['X', '1.1234']],
    [['SKU', 'SL'], ['X', '1'], ['X', '2']], [['SKU', 'SL'], ['=A1', '1']],
    [['SKU', 'SL', 'price'], ['X', '1', '0']],
  ]) assert.throws(() => parseAccountingRows(rows));
  const make = (n: number) => [['SKU', 'SL'], ...Array.from({length:n}, (_,i) => [`SKU-${i}`, '1'])];
  const start = performance.now();
  assert.equal(parseAccountingRows(make(5000)).length, 5000);
  console.log('5000-row parser ms:', Math.round(performance.now() - start));
  assert.throws(() => parseAccountingRows(make(5001)), /5.000/);
  assert.throws(() => parseAccountingRows(make(30000)), /5.000/);
});

test('5000-line draft is atomic, can be approved once and does not touch physical stock', async () => {
  const f = await setupEarly();
  const send = async (path: string, body: unknown) => {
    const r = await f.call('/accounting' + path, f.cookies.mgr, 'POST', body);
    assert.ok(r.status < 300, JSON.stringify(r.data)); return r.data;
  };
  const entity = await send('/entities', { name: 'Test import', taxCode: '0123456789', confirmed:true });
  const book = await send('/books', { name: 'Import test', entityId: entity.id });
  const physical = await f.client.query('select count(*)::int as n from stock_moves');
  const lines = Array.from({length:5000}, (_,i) => ({sku:`FILE-${i}`, name:`Test ${i}`, unit:'Cái', quantity:1, netValue:1000, taxRate:null}));
  const body = {kind:'opening', reference:'FILE-5000', date:'2026-11-01', note:'Test synthetic', lines};
  const started = performance.now();
  const d = await send(`/books/${book.id}/documents`, body);
  console.log('5000-line draft local PostgreSQL WASM ms:', Math.round(performance.now()-started));
  const count = await f.client.query<{n:number, last:number}>('select count(*)::int n,max(line_no)::int last from accounting_lines where document_id=$1', [d.id]);
  assert.deepEqual(count.rows, [{n:5000,last:5000}]);
  const tooMany = await f.call(`/accounting/books/${book.id}/documents`, f.cookies.mgr, 'POST', {...body, reference:'OVER', lines:[...lines, {...lines[0], sku:'OVER'}]});
  assert.equal(tooMany.status,400);
  const postStart = performance.now();
  await send(`/documents/${d.id}/post`, {revision:1, confirmed:true});
  console.log('5000-line approval local PostgreSQL WASM ms:', Math.round(performance.now()-postStart));
  const report = await f.call(`/accounting/report?entityId=${entity.id}&bookId=${book.id}&from=2026-11-01&to=2026-11-13`, f.cookies.mgr);
  assert.equal(report.status,200);
  assert.equal(report.data.stock.length,5000);
  assert.equal(report.data.totals.stockValue,5000000);
  assert.deepEqual(await f.client.query('select count(*)::int as n from stock_moves'),physical);
  // A failure beyond the first insert batch must leave no partial document.
  await f.client.exec("create function reject_import_test() returns trigger language plpgsql as $$ begin if new.sku='FAIL-BATCH' then raise exception 'synthetic failure'; end if; return new; end $$; create trigger reject_import_test before insert on accounting_lines for each row execute function reject_import_test();");
  const failed = await f.call(`/accounting/books/${book.id}/documents`, f.cookies.mgr, 'POST', {...body,kind:'purchase', reference:'ROLLBACK', lines: lines.slice(0,401).map((l,i) => i===250 ? {...l,sku:'FAIL-BATCH'} : l)});
  assert.ok(failed.status>=400);
  assert.equal((await f.client.query<{n:number}>("select count(*)::int n from accounting_documents where reference='ROLLBACK'")).rows[0]?.n,0);
  await f.client.exec('drop trigger reject_import_test on accounting_lines');
  await send(`/books/${book.id}/documents`, {...body, kind:'purchase', reference:'SECOND-5000'});
  await f.client.exec(`insert into accounting_lines(document_id,line_no,sku,name,unit,quantity,net_value)
    select '${d.id}',5000+n,'LIMIT-'||n,'Synthetic limit','Cái',1,0 from generate_series(1,40000)n`);
  const beyond = await f.call(`/accounting/books/${book.id}/documents`,f.cookies.mgr,'POST',{...body,kind:'purchase',reference:'BEYOND-REPORT',lines:lines.slice(0,1)});
  assert.equal(beyond.status,413);
  assert.equal((await f.client.query<{n:number}>("select count(*)::int n from accounting_documents where reference='BEYOND-REPORT'")).rows[0]?.n,0);
  for (const role of ['emp','kho','ncc']) assert.equal((await f.call('/accounting/import-products', f.cookies[role], 'POST', {skus:['FILE-1']})).status,403);
  assert.equal((await f.call('/accounting/import-products',f.cookies.kt,'POST',{skus:lines.map(l=>l.sku)})).status,200);
});

test('imports share CRM retail list prices without wholesale/VAT fallback or missing-to-zero conversion', async () => {
  const f=await setupEarly();
  await f.client.exec(`insert into price_policies(id,name,sort_order) values ('wholesale','Giá sỉ',0),('vat','Giá lẻ +VAT',1),('list','Giá bán lẻ',2);
    insert into products(sku,name,unit,updated_at) values ('LIST-A','Synthetic A','Cái','2026-11-01'),('LIST-MISSING','Synthetic missing','Bộ','2026-11-01');
    insert into product_prices(sku,policy_id,price) values ('LIST-A','list',12345),('LIST-A','wholesale',1),('LIST-A','vat',13332.6),('LIST-MISSING','wholesale',10);`);
  const lookup=await f.call('/accounting/import-products',f.cookies.kt,'POST',{skus:['LIST-A','LIST-MISSING','UNKNOWN']});
  assert.equal(lookup.status,200);
  assert.equal(lookup.data.pricePolicy.id,'list');
  assert.equal(lookup.data.pricePolicy.basis,'before-vat');
  assert.equal(lookup.data.products.find((p:any)=>p.sku==='LIST-A').unitPrice,12345);
  assert.equal(lookup.data.products.find((p:any)=>p.sku==='LIST-MISSING').unitPrice,null);
  assert.ok(lookup.data.priceAsOf);
  await f.client.exec("delete from product_prices where policy_id='list'; delete from price_policies where id='list';");
  const noRetail=await f.call('/accounting/import-products',f.cookies.mgr,'POST',{skus:['LIST-A']});
  assert.equal(noRetail.data.pricePolicy,null);
  assert.equal(noRetail.data.products[0].unitPrice,null);
});
