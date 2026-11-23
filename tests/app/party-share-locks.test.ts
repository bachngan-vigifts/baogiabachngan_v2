import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {suppliers,incomingShipments,purchaseOrderIntents} from '../../src/modules/suppliers/schema.ts';

/** Inject a local fixture change at the exact boundary after preflight, before BEGIN. */
function beforeTransaction(env:any,db:any,change:()=>Promise<unknown>){
 let pending=true;
 env.db=new Proxy(db,{get(target,key){if(key==='transaction')return async(fn:any,config:any)=>{if(pending){pending=false;await change();}return target.transaction(fn,config);};return Reflect.get(target,key,target);}});
}
/** Observe SQL actually executed by PGlite transaction queries (not source text matching). */
function transactionSql(client:any){
 const statements:string[]=[],transaction=client.transaction.bind(client);
 client.transaction=(fn:any)=>transaction(async(tx:any)=>{const query=tx.query.bind(tx);tx.query=(text:string,...args:any[])=>{statements.push(text);return query(text,...args);};return fn(tx);});
 return statements;
}
const body=()=>({clientKey:crypto.randomUUID(),orders:[{supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'0001',quantity:2}]}]});

test('NCC bị ngừng giữa preflight và transaction: không tạo đơn/intent một phần',async()=>{
 const f=await setupEarly(),request=body();
 const before=(await f.db.select().from(incomingShipments)).length;
 beforeTransaction(f.env,f.db,()=>f.db.update(suppliers).set({active:false}).where(eq(suppliers.id,'a')));
 const r=await f.call('/purchase-orders',f.cookies.emp,'POST',request);assert.equal(r.status,409,JSON.stringify(r.data));
 assert.equal((await f.db.select().from(incomingShipments)).length,before);assert.equal((await f.db.select().from(purchaseOrderIntents)).length,0);
});

test('NCC đổi tên trước BEGIN: lưu snapshot mới bằng SELECT FOR SHARE trong transaction',async()=>{
 const f=await setupEarly(),sql=transactionSql(f.client);
 beforeTransaction(f.env,f.db,()=>f.db.update(suppliers).set({name:'Tên mới trong transaction'}).where(eq(suppliers.id,'a')));
 const r=await f.call('/purchase-orders',f.cookies.emp,'POST',body());assert.equal(r.status,201,JSON.stringify(r.data));
 const [created]=await f.db.select().from(incomingShipments).where(eq(incomingShipments.id,r.data.ids[0]));assert.equal(created!.supplierName,'Tên mới trong transaction');
 assert.ok(sql.some(q=>q.includes('"suppliers"')&&/for share\b/i.test(q)),JSON.stringify(sql.filter(q=>/for share\b/i.test(q))));
});

test('Giao hồ sơ đọc người nhận và quyền chức vụ bằng FOR SHARE, vẫn kiểm đích trong transaction',async()=>{
 const f=await setupWarehouseOps();
 const q=await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'LOCK-RECIPIENT',date:'2026-11-21',vat:8,customerTaxCode:'1800000001',customer:'Khách',rows:[{sku:'00123',name:'Ly',qty:1,price:1000}]});assert.equal(q.status,201,JSON.stringify(q.data));
 assert.equal((await f.call('/quotes/'+q.data.id+'/approve',f.mgr,'POST',{revision:1})).status,200);
 const o=await f.call('/orders',f.emp,'POST',{quoteId:q.data.id,warehouseId:'pos-wh'});assert.equal(o.status,201);
 const sql=transactionSql(f.client),r=await f.call('/orders/'+o.data.id+'/sale-admin-assignment',f.emp,'POST',{assigneeId:'ops-admin',revision:0});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.ok(sql.some(q=>q.includes('"staff_members"')&&/for share\b/i.test(q)),JSON.stringify(sql.filter(q=>/for share\b/i.test(q))));
 assert.ok(sql.some(q=>q.includes('"staff_position_permissions"')&&/for share\b/i.test(q)),JSON.stringify(sql.filter(q=>/for share\b/i.test(q))));
});
