import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from './pos-fixture.ts';
import {PASSWORD} from './staff-fixture.ts';
import {hashPassword} from '../../src/core/auth/password.ts';
import {employees,credentials,positionPermissions,positions} from '../../src/modules/staff/schema.ts';
export async function setupWarehouseOps(){
 const f=await setup();
 await f.db.insert(employees).values({id:'ops-admin',name:'Sale Admin kiểm thử',email:'ops-admin@x.vn',role:'employee',positionId:'sale-admin',createdAt:new Date().toISOString()});
 await f.db.insert(credentials).values({memberId:'ops-admin',passwordHash:await hashPassword(PASSWORD,1000),version:0});
 await f.db.insert(positionPermissions).values(['inventory.view','inventory.manage','page.orders','page.quotes','page.deliveries'].map(permission=>({positionId:'sales-lock',permission}))).onConflictDoNothing();
 // A second reader can see the order but still must not confirm another employee's delivery.
 await f.db.update(positions).set({dataScope:'all'}).where(eq(positions.id,'sales-lock'));
 const sa=(await f.call('/login','','POST',{email:'ops-admin@x.vn',password:PASSWORD})).cookie;
 return {...f,sa};
}
export async function makeCrm(f:Awaited<ReturnType<typeof setupWarehouseOps>>,key:string,qty=2,sku='00123',warehouseId='pos-wh',printing=false){
 const q=await f.call('/quotes',f.emp,'POST',{type:printing?'B2B':'HRC',quoteNo:'OPS_'+key,date:'2026-10-26',customer:'Khách thử '+key,vat:8,...(printing?{printing:{totalCost:qty*50}}:{}),rows:[{sku,name:'Hàng thử '+sku,unit:'Cái',qty,price:1000,...(printing?{printFee:100}:{})}]});assert.equal(q.status,201,JSON.stringify(q.data));
 let revision=1;
 if(printing){const saved=(await f.call('/quotes/'+q.data.id,f.mgr)).data;
  const edited=await f.call('/quotes/'+q.data.id,f.mgr,'PUT',{revision:saved.revision,data:{...saved.data,printing:{totalCost:qty*50},rows:saved.data.rows.map((r:Record<string,unknown>)=>({...r,printing:{unitPrice:50}}))}});assert.equal(edited.status,200,JSON.stringify(edited.data));revision=edited.data.revision;}
 assert.equal((await f.call('/quotes/'+q.data.id+'/approve',f.mgr,'POST',{revision})).status,200);
 const order=await f.call('/orders',f.emp,'POST',{quoteId:q.data.id,warehouseId,pushSapo:false});assert.equal(order.status,201,JSON.stringify(order.data));
 const confirmed=await f.call('/orders/'+order.data.id+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
 return (await f.call('/orders/'+order.data.id,f.mgr)).data;
}
