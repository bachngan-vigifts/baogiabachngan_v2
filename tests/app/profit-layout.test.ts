import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitLayoutFixture } from '../helpers/profit-layout-fixture.ts';

test('bố cục theo mẫu giai đoạn 2: bộ lọc → bảng phân tích → cảnh báo → KPI/đối soát/chi phí; mặc định gồm giá tham chiếu có cảnh báo', async () => {
  const { initProfit } = await import(new URL('../../trial-ui/profit.js', import.meta.url).href);
  const response=profitLayoutFixture(),before=structuredClone(response),requests:string[]=[];
  const root={innerHTML:'',setAttribute(){},removeAttribute(){},querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]};
  const ui=initProfit({root,api:async(path:string)=>{requests.push(path);return response;},toast(){},esc:(v:unknown)=>String(v??''),money:(n:number)=>String(n)});
  await ui.show();
  assert.equal(requests.length,1);assert.match(requests[0]!,/^\/profit\?/);assert.doesNotMatch(requests[0]!,/costs=confirmed/,'mặc định gồm giá tham chiếu để không làm mất số liệu đơn cũ');
  const html=root.innerHTML,at=(s:string)=>html.indexOf(s);
  const warn=at('giá vốn ước tính / tham chiếu'),kpis=at('class="pf-kpis"'),check=at('Đối soát khớp'),bridge=at('Từ doanh thu đến lợi nhuận sau chi phí'),cash=at('Phân loại phiếu chi sổ quỹ'),tabs=at('role="tablist"'),rules=at('Quy tắc &amp; cảnh báo')>=0?at('Quy tắc &amp; cảnh báo'):at('Quy tắc & cảnh báo');
  assert.ok(warn>=0&&warn<kpis,'cảnh báo nguồn giá vốn ở đầu trang');
  assert.ok(at('class="pf-filters"')<tabs&&tabs<warn&&kpis<check&&check<bridge&&bridge<cash&&cash<rules,'bảng phân tích ngay dưới bộ lọc, trước các thẻ số liệu');
  assert.equal((html.match(/<div class="card"><small>/g)||[]).length,5,'5 thẻ KPI');
  assert.match(html,/data-tab="owners" aria-selected="true"/,'tab Nhân viên mặc định');
  assert.match(html,/id="pf-confirm"/,'nút xác nhận giá vốn chưa xác nhận');
  assert.match(html,/data-cash-entry="e0"/,'phiếu chi có ô chọn loại');
  for(const label of ['Từ doanh thu đến lợi nhuận sau chi phí','Phân loại phiếu chi sổ quỹ','role="tablist"'])assert.equal(html.split(label).length-1,1,'không nhân đôi cụm');
  assert.deepEqual(response,before,'không đổi dữ liệu trả về');
});
