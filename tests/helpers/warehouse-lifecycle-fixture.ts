import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupEarly} from './purchase-early-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {salesOrderLines} from '../../src/modules/sales/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
/** Đơn CRM 2+3 bộ trà ở KHO VIGIFTS (chưa có hàng), kho khác có 10; đơn mua NCC a1 chờ nhận 5 (tests/app/warehouse-lifecycle.test.ts). */
export const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
export const photo='data:image/jpeg;base64,'+'A'.repeat(200);
export const sku='031106000';
export async function fixture(){
 const f=await setupEarly(),now=new Date().toISOString(),router=createAppRouter(),outbound:any[]=[];
 await f.db.insert(products).values({sku,name:'Bộ trà kiểm thử',unit:'Bộ',updatedAt:now});
 await f.db.insert(warehouses).values([{id:'vig',name:'KHO VIGIFTS',kind:'stock'},{id:'other',name:'Kho khác',kind:'stock'}]);
 await postMoves(f.db,'mgr',[{sku:'BOOT',warehouseId:'vig',qty:1,kind:'opening',refType:'opening',refId:'opening'},{sku,warehouseId:'other',qty:10,kind:'opening',refType:'opening',refId:'opening'}]);
 await f.db.update(incomingShipmentLines).set({quantity:5,price:1000,purchaseDiscount:0,confirmedPurchaseDiscount:0,taxRate:8}).where(eq(incomingShipmentLines.id,'line-a1'));
 const env:StaffEnv={db:f.db,passwordIterations:1000,sapoOrderPush:'off',sapoSyncToken:'integration-test-only-sync-token-32-chars',sapoGoodsReceiptWebhookUrl:'https://n8nthai.moarchvn.com/webhook/test-only',
  sapoWebhookFetch:async(_url,init)=>{outbound.push(JSON.parse(String(init?.body)));return new Response('{}',{status:202});}};
 const call=async(path:string,cookie=f.cookies.mgr,method='GET',body?:unknown)=>{
  const headers:Record<string,string>={origin:'https://trial.test','content-type':'application/json',cookie:cookie||''};if(path.startsWith('/integrations/'))headers['x-sapo-sync-token']=env.sapoSyncToken!;
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json() as any};};
 const q=ok(await call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'FULL-'+crypto.randomUUID(),customer:'Khách kiểm thử',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty:2,price:2000},{sku,name:'Bộ trà',unit:'Bộ',qty:3,price:2000}]}),201);
 ok(await call('/quotes/'+q.id+'/approve',f.cookies.mgr,'POST',{revision:1}));
 const order=ok(await call('/orders',f.cookies.emp,'POST',{quoteId:q.id,warehouseId:'vig'}),201);
 const lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,order.id)).orderBy(salesOrderLines.lineNo);
 ok(await call(`/orders/${order.id}/status`,f.cookies.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
 const trip=ok(await call('/deliveries',f.cookies.emp,'POST',{orderId:order.id,plannedDate:'2026-10-24',lines:lines.map(l=>({orderLineId:l.id,qty:l.qty}))}),201);
 const balance=async(wh='vig')=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,sku),eq(stockBalances.warehouseId,wh))))[0]?.qty??0;
 const pack=async(index:number,source='warehouse')=>{
  const p=ok(await call(`/orders/${order.id}/packing`,f.cookies.emp,'POST',{allocations:[{orderLineId:lines[index]!.id,qty:lines[index]!.qty,source,sourceNote:source==='warehouse'?'':'NCC giao trực tiếp'}]}),201).slips[0];
  ok(await call('/packing/'+p.id+'/send',f.cookies.emp,'POST',{}));return p;};
 return {...f,call,order,lines,trip,balance,pack,outbound};
}
