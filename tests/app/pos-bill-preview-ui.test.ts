import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../../trial-ui/pos-returns.js',import.meta.url),'utf8');
test('return screen: bill number opens a read-only quick view from already loaded data',()=>{
 assert.match(src,/export function openBillPreview\(d,/);
 assert.match(src,/el\('button', 'pos-bill-link', d\.order\.orderNo\)/);
 assert.match(src,/link\.onclick = \(\) => openBillPreview\(d\);/);
 const preview=src.slice(src.indexOf('export function openBillPreview'),src.indexOf('/** Linked POS returns only'));
 assert.doesNotMatch(preview,/api\(|fetch\(|innerHTML/,'chỉ đọc dữ liệu đã tải, không gọi API, không chèn HTML');
 assert.match(preview,/'#\/orders\/' \+ encodeURIComponent\(o\.id\)/);
});
