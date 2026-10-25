import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import type {AnyDb} from '../../src/core/db/client.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
/** Financial/history fixtures start with received warehouse stock, then issue it through the real packing API. */
export async function confirmWarehouseSupply(db:AnyDb,call:(path:string,cookie?:string,method?:string,body?:object)=>Promise<any>,manager:string,orderId:string){
 const view=await call(`/orders/${orderId}/packing`,manager);assert.equal(view.status,200,JSON.stringify(view.data));
 const pending=view.data.lines.filter((l:any)=>l.left>0);
 const allocations=pending.map((l:any)=>({orderLineId:l.id,qty:l.left,source:'supplier',sourceNote:'Hàng NCC đã vào kho kiểm thử trước khi xuất giao'}));
 if(!allocations.length)return;
 const warehouseId='fixture-stock-'+orderId;
 await db.insert(warehouses).values({id:warehouseId,name:'Kho kiểm thử '+orderId,kind:'stock'});
 await postMoves(db,'mgr',pending.filter((l:any)=>l.sku).map((l:any)=>({sku:l.sku,warehouseId,qty:l.left,kind:'opening' as const,refType:'opening' as const,refId:orderId})));
 const made=await call(`/orders/${orderId}/packing`,manager,'POST',{allocations});assert.equal(made.status,201,JSON.stringify(made.data));
 for(const p of made.data.slips){const sent=await call(`/packing/${p.id}/send`,manager,'POST',{});assert.equal(sent.status,200,JSON.stringify(sent.data));
  const confirmed=await call(`/packing/${p.id}/confirm`,manager,'POST',{warehouseId,photos:['data:image/jpeg;base64,'+'A'.repeat(200)]});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
  const moves=await db.select().from(stockMoves).where(and(eq(stockMoves.refType,'packing_slip'),eq(stockMoves.refId,p.id)));
  assert.ok(moves.length,'SKU goods require actual warehouse issue proof');}
 const balances=await db.select().from(stockBalances).where(eq(stockBalances.warehouseId,warehouseId));
 assert.ok(balances.every(b=>b.qty===0),'received fixture stock must be fully issued');
}
