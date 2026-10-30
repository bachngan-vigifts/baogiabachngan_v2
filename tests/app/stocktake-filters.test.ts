import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';

test('danh sách phiếu kiểm kê lọc theo số phiếu / mã hàng / lý do, người lập, kho, khoảng ngày; trả danh sách người lập và tên sản phẩm', async () => {
 const f=await setupWarehouseOps();
 const send=(key:string,reason:string)=>f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:key,warehouseId:'pos-wh',reason,lines:[{sku:'00123',expectedQty:10,countedQty:9}]});
 const a=await send('stocktake-filter-001','Kiểm cuối tháng');assert.equal(a.status,201,JSON.stringify(a.data));
 const list=(q:string)=>f.call('/inventory/adjustments?kind=stocktake&status=&'+q,f.mgr);
 assert.equal((await list('q='+encodeURIComponent(a.data.refNo))).data.adjustments.length,1,'theo số phiếu');
 assert.equal((await list('q=00123')).data.adjustments.length,1,'theo mã hàng trong phiếu');
 assert.equal((await list('q=cu%E1%BB%91i%20th%C3%A1ng')).data.adjustments.length,1,'theo lý do');
 assert.equal((await list('q=khong-co')).data.adjustments.length,0);
 assert.equal((await list('q=%25')).data.adjustments.length,0,'ký tự % được coi là chữ, không phải ký tự đại diện');
 const all=await list('');assert.deepEqual(all.data.filterOptions.creators.map((c:any)=>c.id),['emp']);
 assert.equal((await list('createdBy=emp')).data.adjustments.length,1);
 assert.equal((await list('createdBy=mgr')).data.adjustments.length,0);
 assert.equal((await list('warehouseId=pos-wh')).data.adjustments.length,1);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
 assert.equal((await list('from='+today+'&to='+today)).data.adjustments.length,1,'trong ngày (giờ Việt Nam)');
 assert.equal((await list('to=2020-01-01')).data.adjustments.length,0);
 assert.equal((await list('from=2026-10-30&to=2026-10-01')).status,400,'từ ngày sau đến ngày');
 assert.equal((await list('from=30-10-2026')).status,400);
 const detail=await f.call('/inventory/stocktakes/'+a.data.id,f.mgr);
 assert.equal(typeof detail.data.names['00123'].name,'string','màn xem phiếu có tên sản phẩm');
});
