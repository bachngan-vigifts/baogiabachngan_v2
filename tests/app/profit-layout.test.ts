import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitLayoutFixture } from '../helpers/profit-layout-fixture.ts';

test('ba cụm tổng hợp lợi nhuận nằm sau KPI, trước bảng lương/phiếu chi; giữ cảnh báo nguồn số liệu', async () => {
  const { initProfit } = await import(new URL('../../trial-ui/profit.js', import.meta.url).href);
  const response=profitLayoutFixture(),before=structuredClone(response),requests:string[]=[];
  const root={innerHTML:'',querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]};
  const ui=initProfit({root,api:async(path:string)=>{requests.push(path);return response;},toast(){},esc:(v:unknown)=>String(v??''),money:(n:number)=>String(n)});
  await ui.show();
  assert.equal(requests.length,1);assert.match(requests[0]!,/^\/profit\?/);
  const html=root.innerHTML,kpis=html.indexOf('class="pf-kpis"'),chart=html.indexOf('Lợi nhuận gộp theo tháng'),branch=html.indexOf('Theo chi nhánh (sau chi phí chi nhánh)'),tabs=html.indexOf('role="tablist"'),staff=html.indexOf('Chi phí nhân sự bán hàng'),cash=html.indexOf('Phân loại phiếu két trong kỳ');
  assert.ok(kpis>=0&&chart>kpis&&branch>chart&&tabs>branch);
  assert.ok(staff>tabs&&cash>tabs,'bảng chi tiết chi phí không đẩy biểu đồ xuống cuối trang');
  assert.ok(html.indexOf('giá mua tham chiếu')<kpis,'cảnh báo nguồn vẫn ở vùng đầu trang');
  for(const label of ['Lợi nhuận gộp theo tháng','Theo chi nhánh (sau chi phí chi nhánh)','role="tablist"'])assert.equal(html.split(label).length-1,1,'không nhân đôi cụm');
  assert.deepEqual(response,before,'chỉ đổi thứ tự hiển thị, không đổi dữ liệu trả về');
});
