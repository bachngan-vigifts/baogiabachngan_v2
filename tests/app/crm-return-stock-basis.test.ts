import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

/**
 * Trả hàng CRM chỉ nhập lại kho trong phạm vi đã thực xuất (crm-return-stock.ts). Đơn cũ giao khi chưa ghi xuất:
 * Manager phải chọn căn cứ kiểm được; không căn cứ → không cộng tồn. Gửi lặp / đồng thời không cộng hai lần.
 */
async function fixture(){
 const f=await setupCrmReturns(),at=new Date().toISOString();
 await f.db.insert(products).values([{sku:'09566',name:'Bộ 09',unit:'Bộ',updatedAt:at},{sku:'22566',name:'Bộ 22',unit:'Bộ',updatedAt:at}]);
 const balance=async(sku='09566')=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,sku),eq(stockBalances.warehouseId,'pos-wh'))))[0]?.qty??0;
 const path=(id:string,r='')=>`/orders/${id}/returns${r?'/'+r:''}`;
 const request=async(id:string,qty=2,line='a')=>f.ok(await f.call(path(id),f.emp,'POST',{key:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Khách trả',lines:[{orderLineId:`${id}-${line}`,qty,disposition:'restock'}]}),201);
 const approve=(id:string,r:string,stockBasis?:unknown)=>f.call(path(id,r+'/approve'),f.mgr,'POST',stockBasis===undefined?{}:{stockBasis});
 const receive=(id:string,r:string)=>f.call(path(id,r+'/receive'),f.emp,'POST',{confirmed:true});
 const adjust=async(qty:number,key:string)=>f.ok(await f.call('/inventory/adjustments',f.mgr,'POST',{clientKey:key,warehouseId:'pos-wh',reason:'Bù xuất thiếu đơn cũ',lines:[{sku:'09566',qty}]}),201);
 return {...f,balance,request,approve,receive,adjust};
}

test('đơn đã xuất có bút toán: nhập lại trong phạm vi đã xuất không cần căn cứ',async()=>{
 const f=await fixture();await f.seed('ok');
 const r=await f.request('ok');f.ok(await f.approve('ok',r.id));f.ok(await f.receive('ok',r.id));assert.equal(await f.balance(),2);
});

test('xuất 1 / trả 2: phần vượt bị chặn khi duyệt và khi nhận; không cộng tồn khi chưa có căn cứ',async()=>{
 const f=await fixture();await f.seed('part',2186125,'emp',false);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:1,kind:'opening',refType:'opening',refId:'open-part'}]);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:-1,kind:'sale',refType:'sales_order',refId:'part'}]);
 await f.db.update(salesOrders).set({orderDate:'2999-01-01'}).where(eq(salesOrders.id,'part'));
 const r=await f.request('part');
 const listed=f.ok(await f.call('/orders/part/returns',f.emp)).returns[0].stockCheck;
 assert.deepEqual(listed.unproven.map((l:any)=>[l.sku,l.qty,l.issued]),[['09566',1,1]]);assert.equal(listed.basis,null);
 const denied=await f.approve('part',r.id);assert.equal(denied.data.code,'RETURN_STOCK_UNPROVEN');assert.match(denied.data.error,/09566: nhập lại 2, đã xuất có chứng từ 1/);
 assert.equal((await f.approve('part',r.id,{kind:'pre_opening',note:'Giao trước chốt'})).data.code,'STOCK_BASIS_INVALID','đơn lập sau ngày chốt');
 assert.equal((await f.approve('part',r.id,{kind:'other',note:'Không rõ nguồn'})).data.code,'STOCK_BASIS_REQUIRED');
 assert.equal((await f.receive('part',r.id)).status,409,'chưa duyệt');assert.equal(await f.balance(),0);
});

test('đơn cũ lập trước ngày chốt, không có chuyến giao: căn cứ "giao trước chốt" được nhận; lưu căn cứ + nhật ký',async()=>{
 const f=await fixture();await f.seed('old',2186125,'emp',false);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:0.001,kind:'opening',refType:'opening',refId:'open-old'}]);
 const r=await f.request('old');
 assert.equal((await f.approve('old',r.id,{kind:'pre_opening',note:'ab'})).data.code,'STOCK_BASIS_NOTE');
 f.ok(await f.approve('old',r.id,{kind:'pre_opening',note:'Giao 14/10, trước chốt tồn 18/10'}));
 const basis=f.ok(await f.call('/orders/old/returns',f.emp)).returns[0].stockCheck.basis;assert.equal(basis.kind,'pre_opening');assert.equal(basis.by,'mgr');
 f.ok(await f.receive('old',r.id));assert.equal(await f.balance(),2.001);
});

test('căn cứ phiếu điều chỉnh: chỉ dùng tối đa lượng đã trừ bù, cộng dồn mọi phiếu trả; duyệt đồng thời không vượt',async()=>{
 const f=await fixture();await f.seed('x1',2186125,'emp',false);await f.seed('x2',2186125,'emp',false);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:2,kind:'opening',refType:'opening',refId:'open-x'}]);
 await f.db.update(salesOrders).set({orderDate:'2999-01-01'});
 const adj=await f.adjust(-2,'adj-basis-0001');assert.equal(await f.balance(),0);
 const a=await f.request('x1'),b=await f.request('x2');
 const results=await Promise.all([f.approve('x1',a.id,{kind:'adjustment',adjustmentId:adj.id,note:'Đã trừ bù bằng phiếu ĐC'}),f.approve('x2',b.id,{kind:'adjustment',adjustmentId:adj.id,note:'Đã trừ bù bằng phiếu ĐC'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(results.map(r=>r.data)));
 const won=results[0]!.status===200?['x1',a.id]:['x2',b.id];
 f.ok(await f.receive(won[0]!,won[1]!));assert.equal(await f.balance(),2);
});

test('nhận hàng gửi lặp / đồng thời: cộng tồn đúng một lần',async()=>{
 const f=await fixture();await f.seed('dup');
 const r=await f.request('dup');f.ok(await f.approve('dup',r.id));
 const rs=await Promise.all([1,2,3].map(()=>f.receive('dup',r.id)));
 assert.ok(rs.every(x=>x.status===200),JSON.stringify(rs.map(x=>x.data)));assert.equal(rs.filter(x=>!x.data.replayed).length,1);
 assert.equal(await f.balance(),2);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,1);
 f.ok(await f.receive('dup',r.id));assert.equal(await f.balance(),2);
});

test('trả lần hai vượt tổng đã xuất bị chặn dù từng dòng còn trong số đã giao',async()=>{
 const f=await fixture();await f.seed('two',2186125,'emp',false);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:1,kind:'opening',refType:'opening',refId:'open-two'}]);
 await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:-1,kind:'sale',refType:'sales_order',refId:'two'}]);
 const first=await f.request('two',1);f.ok(await f.approve('two',first.id));f.ok(await f.receive('two',first.id));assert.equal(await f.balance(),1);
 await f.db.update(salesOrders).set({orderDate:'2999-01-01'}).where(eq(salesOrders.id,'two'));
 const second=await f.request('two',1);assert.equal((await f.approve('two',second.id)).data.code,'RETURN_STOCK_UNPROVEN');assert.equal(await f.balance(),1);
});
