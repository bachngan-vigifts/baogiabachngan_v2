import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {inventoryAdjustments,stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';

/** Phiếu điều chỉnh: bấm lặp, mạng gửi lại, hai tab gửi cùng lúc không được ghi tồn hai lần (chạy cả trên PostgreSQL thật: TEST_PG_URL). */
async function fixture(){
 const f=await setupWarehouseOps();
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;
 const docs=async()=>(await f.db.select().from(inventoryAdjustments)).length;
 return {...f,balance,docs,body:{warehouseId:'pos-wh',reason:'Kiểm kê thừa một cái',lines:[{sku:'00123',qty:1}]}};
}

test('thiếu mã chống gửi lặp: Manager cũng bị từ chối, không tạo phiếu, không đổi tồn; báo phiếu trùng vừa lập',async()=>{
 const f=await fixture();
 const r=await f.call('/inventory/adjustments',f.mgr,'POST',f.body);
 assert.equal(r.status,409);assert.equal(r.data.code,'ADJUSTMENT_KEY_REQUIRED');assert.equal(await f.docs(),0);assert.equal(await f.balance(),10);
 const made=await f.call('/inventory/adjustments',f.mgr,'POST',{...f.body,clientKey:'adjust-retry-0001'});assert.equal(made.status,201);
 const again=await f.call('/inventory/adjustments',f.mgr,'POST',f.body);
 assert.equal(again.status,409);assert.match(again.data.error,new RegExp(made.data.refNo));
 assert.equal(await f.docs(),1);assert.equal(await f.balance(),11);
});

test('gửi lại cùng mã (mất phản hồi, bấm lặp): một phiếu, tồn cộng một lần; đổi nội dung cùng mã bị chặn',async()=>{
 const f=await fixture(),body={...f.body,clientKey:'adjust-retry-0002'};
 assert.equal((await f.call('/inventory/adjustments',f.mgr,'POST',body)).status,201);
 const replay=await f.call('/inventory/adjustments',f.mgr,'POST',body);
 assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
 assert.equal((await f.call('/inventory/adjustments',f.mgr,'POST',{...body,lines:[{sku:'00123',qty:2}]})).status,409);
 assert.equal(await f.docs(),1);assert.equal(await f.balance(),11);
});

test('năm request cùng mã gửi đồng thời: đúng một phiếu, một dòng sổ kho',async()=>{
 const f=await fixture(),body={...f.body,clientKey:'adjust-retry-0003'};
 const rs=await Promise.all(Array.from({length:5},()=>f.call('/inventory/adjustments',f.mgr,'POST',body)));
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,200,200,200,201],JSON.stringify(rs.map(r=>r.data)));
 assert.equal(new Set(rs.map(r=>r.data.id)).size,1);
 assert.equal(await f.docs(),1);assert.equal(await f.balance(),11);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'adjustment'))).length,1);
});

test('duyệt phiếu chờ đồng thời từ hai máy: ghi tồn một lần',async()=>{
 const f=await fixture();
 const pending=await f.call('/inventory/adjustments',f.emp,'POST',{...f.body,clientKey:'adjust-retry-0004'});assert.equal(pending.status,201);
 const rs=await Promise.all([1,2,3].map(()=>f.call('/inventory/adjustments/'+pending.data.id+'/review',f.mgr,'POST',{decision:'approved'})));
 assert.ok(rs.every(r=>r.status===200),JSON.stringify(rs.map(r=>r.data)));
 assert.equal(rs.filter(r=>!r.data.replayed).length,1);assert.equal(await f.balance(),11);
});
