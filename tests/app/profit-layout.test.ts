import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitLayoutFixture } from '../helpers/profit-layout-fixture.ts';

test('bố cục theo mẫu giai đoạn 2: cảnh báo → 5 KPI → đối soát → DT→LN sau CP + phiếu chi → tab (Nhân viên) → quy tắc; mặc định chỉ giá vốn chính xác', async () => {
  const { initProfit } = await import(new URL('../../trial-ui/profit.js', import.meta.url).href);
  const response=profitLayoutFixture(),before=structuredClone(response),requests:string[]=[];
  const root={innerHTML:'',querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]};
  const ui=initProfit({root,api:async(path:string)=>{requests.push(path);return response;},toast(){},esc:(v:unknown)=>String(v??''),money:(n:number)=>String(n)});
  await ui.show();
  assert.equal(requests.length,1);assert.match(requests[0]!,/^\/profit\?/);assert.match(requests[0]!,/costs=confirmed/,'mặc định chỉ giá vốn chính xác');
  const html=root.innerHTML,at=(s:string)=>html.indexOf(s);
  const warn=at('giá vốn ước tính / tham chiếu'),kpis=at('class="pf-kpis"'),check=at('Đối soát khớp'),bridge=at('Từ doanh thu đến lợi nhuận sau chi phí'),cash=at('Phân loại phiếu chi sổ quỹ'),tabs=at('role="tablist"'),rules=at('Quy tắc &amp; cảnh báo')>=0?at('Quy tắc &amp; cảnh báo'):at('Quy tắc & cảnh báo');
  assert.ok(warn>=0&&warn<kpis,'cảnh báo nguồn giá vốn ở đầu trang');
  assert.ok(kpis<check&&check<bridge&&bridge<cash&&cash<tabs&&tabs<rules,'thứ tự theo mẫu');
  assert.equal((html.match(/<div class="card"><small>/g)||[]).length,5,'5 thẻ KPI');
  assert.match(html,/data-tab="owners" aria-selected="true"/,'tab Nhân viên mặc định');
  assert.match(html,/id="pf-confirm"/,'nút xác nhận giá vốn chưa xác nhận');
  assert.match(html,/data-cash-entry="e0"/,'phiếu chi có ô chọn loại');
  for(const label of ['Từ doanh thu đến lợi nhuận sau chi phí','Phân loại phiếu chi sổ quỹ','role="tablist"'])assert.equal(html.split(label).length-1,1,'không nhân đôi cụm');
  assert.deepEqual(response,before,'không đổi dữ liệu trả về');
});
