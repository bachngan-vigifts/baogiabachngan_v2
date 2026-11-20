import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,and} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {stockMoves,stockBalances} from '../../src/modules/inventory/schema.ts';
import {posReturns,posRefunds,posReturnLines} from '../../src/modules/sales/return-schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';

const fin=(id:string,rid:string)=>`/orders/${id}/returns/${rid}/finalize`;
test('một bước: Manager duyệt + nhận hàng + hoàn tiền + hoàn tất trong một lần bấm; bấm lại không ghi trùng',async()=>{
 const f=await setupCrmReturns();await f.seed('one');
 const {data:r}=await f.create('one',[{orderLineId:'one-b',qty:2,disposition:'restock'}]);
 const body={confirmed:true,refund:{key:crypto.randomUUID(),amount:585241,method:'transfer',reference:'CK-001',drawerId:'store'}};
 const out=f.ok(await f.call(fin('one',r.id),f.mgr,'POST',body));
 assert.deepEqual(out.steps,['approved','received','refunded','completed']);assert.equal(out.status,'completed');assert.equal(out.available,0);
 const [row]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(row!.approvedBy,'mgr');assert.equal(row!.receivedBy,'mgr');
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,1);
 assert.equal((await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'22566'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty,2);
 const again=f.ok(await f.call(fin('one',r.id),f.mgr,'POST',body));assert.equal(again.replayed,true);
 assert.equal((await f.db.select().from(posRefunds).where(eq(posRefunds.returnId,r.id))).length,1);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,1);
 const actions=(await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,r.id))).map(a=>a.action);
 for(const a of ['crm-approve-return','crm-receive-return','crm-refund','crm-complete-return'])assert.ok(actions.includes(a),a);
});
test('một bước: đơn còn nợ thì không có tiền hoàn, tự hoàn tất sau khi nhận hàng',async()=>{
 const f=await setupCrmReturns();await f.seed('debt',0);
 const {data:r}=await f.create('debt',[{orderLineId:'debt-a',qty:1,disposition:'restock'}]);
 const out=f.ok(await f.call(fin('debt',r.id),f.mgr,'POST',{confirmed:true}));assert.deepEqual(out.steps,['approved','received','completed']);
});
test('một bước: lỗi ở bước hoàn tiền thì không bước nào được ghi (vẫn chờ duyệt, chưa nhập kho)',async()=>{
 const f=await setupCrmReturns();await f.seed('cashfail');
 const {data:r}=await f.create('cashfail',[{orderLineId:'cashfail-b',qty:2,disposition:'restock'}]);
 const res=await f.call(fin('cashfail',r.id),f.mgr,'POST',{confirmed:true,refund:{key:crypto.randomUUID(),amount:585241,method:'cash',drawerId:'store'}});
 assert.equal(res.status,409);assert.equal(res.data.code,'REFUND_SHIFT_REQUIRED');assert.match(res.data.error,/chuyển khoản/);
 const [row]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(row!.status,'pending');assert.equal(row!.receivedAt,null);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,0);
 // Đổi sang chuyển khoản là xong ngay, không phải lập lại phiếu.
 f.ok(await f.call(fin('cashfail',r.id),f.mgr,'POST',{confirmed:true,refund:{key:crypto.randomUUID(),amount:585241,method:'transfer',reference:'CK-9',drawerId:'store'}}));
});
test('một bước: hàng trả vượt lượng đã xuất có chứng từ → chọn không cộng tồn thì xong luôn, không cộng kho',async()=>{
 const f=await setupCrmReturns();await f.seed('old',2186125,'emp',false);
 const {data:r}=await f.create('old',[{orderLineId:'old-b',qty:2,disposition:'restock'}]);
 const res=await f.call(fin('old',r.id),f.mgr,'POST',{confirmed:true});assert.equal(res.status,409);assert.equal(res.data.code,'RETURN_STOCK_UNPROVEN');
 const out=f.ok(await f.call(fin('old',r.id),f.mgr,'POST',{confirmed:true,unprovenAsDamaged:true}));assert.ok(out.steps.includes('no-restock')&&out.steps.includes('received'));
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,0);
 assert.equal((await f.db.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id)))[0]!.disposition,'damaged');
});
test('một bước: nhân viên không có quyền duyệt bị chặn; người được chỉ định không tự duyệt phiếu của mình',async()=>{
 const f=await setupCrmReturns();await f.seed('perm');
 const {data:r}=await f.create('perm',[{orderLineId:'perm-a',qty:1,disposition:'restock'}]);
 assert.equal((await f.call(fin('perm',r.id),f.emp,'POST',{confirmed:true})).status,403);
 assert.equal((await f.call(fin('perm',r.id),f.mgr,'POST',{})).status,400);
});
test('đề nghị hoàn tiền nhân viên nhập lúc lập phiếu được lưu, hiện cho người duyệt; chưa chi tiền cho tới khi duyệt',async()=>{
 const f=await setupCrmReturns();await f.seed('ask');
 const {data:r}=await f.create('ask',[{orderLineId:'ask-b',qty:2,disposition:'restock'}],{refundRequest:{amount:585241,method:'transfer',reference:'VCB 0123 Nguyễn A',note:'Khách cần hoàn trong ngày'}});
 let d=f.ok(await f.call('/orders/ask/returns',f.emp));const req=d.returns[0].refundRequest;
 assert.equal(req.amount,585241);assert.equal(req.method,'transfer');assert.equal(req.reference,'VCB 0123 Nguyễn A');assert.equal(req.by,'emp');
 assert.equal((await f.db.select().from(posRefunds).where(eq(posRefunds.returnId,r.id))).length,0,'đề nghị không phải là chi tiền');
 f.ok(await f.call(fin('ask',r.id),f.mgr,'POST',{confirmed:true,refund:{key:crypto.randomUUID(),amount:req.amount,method:req.method,reference:req.reference,drawerId:'store'}}));
 d=f.ok(await f.call('/orders/ask/returns',f.mgr));assert.equal(d.returns[0].status,'completed');assert.equal(d.returns[0].refunds[0].reference,'VCB 0123 Nguyễn A');
 // Phiếu "nhận để giao lại" không lưu đề nghị hoàn tiền.
 const {data:g}=await f.create('ask',[{orderLineId:'ask-a',qty:1,disposition:'restock'}],{purpose:'redelivery',refundRequest:{amount:1000,method:'cash'}});
 d=f.ok(await f.call('/orders/ask/returns',f.mgr));assert.equal(d.returns.find((x:any)=>x.id===g.id).refundRequest,null);
});
