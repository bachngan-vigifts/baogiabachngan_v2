import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {products,productPrices,productStock,warehouses} from '../../src/modules/catalog/schema.ts';
import {posRegisters} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {createPosStockCache}:any=await import(new URL('../../trial-ui/pos-stock-cache.js',import.meta.url).href);

test('POS stock preload uses ledger quantities and real reservations, is store/policy authorized and does not write stock',async()=>{
 const f=await setup(),before=(await f.db.select().from(stockMoves)).length;
 const boot=await f.call('/pos/options?stock=1',f.emp);assert.equal(boot.status,200);
 const snapshot=boot.data.stockSnapshot;assert.equal(snapshot.registerId,f.registerId);assert.equal(snapshot.warehouseId,'pos-wh');assert.equal(snapshot.warehouseReady,true);assert.equal(snapshot.catalog[0].sku,'00123');
 assert.deepEqual(snapshot.rows[0].slice(0,4),['00123',108000,10,0],'ignore synced1000 after opening ledger10');
 await f.db.insert(salesOrders).values({id:'hold',orderNo:'HOLD',quoteType:'HRC',customerName:'Test',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-01',warehouseId:'pos-wh',channel:'pos',status:'confirmed',holdsStock:true,total:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 await f.db.insert(salesOrderLines).values({id:'hold-line',orderId:'hold',sku:'00123',name:'Ly',qty:3,unitPrice:1,amount:3,lineNo:1});
 const path='/pos/stock-snapshot?registerId='+f.registerId;
 let fresh=await f.call(path,f.emp);assert.deepEqual(fresh.data.rows[0].slice(2,4),[10,3]);
 assert.equal((await f.call(path+'&pricePolicyId=other',f.emp)).status,400);
 assert.equal((await f.call(path,f.ncc)).status,403);
 assert.equal((await f.db.select().from(stockMoves)).length,before);
 await postMoves(f.db as never,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:2,kind:'customer_return',refType:'pos_return',refId:'fixture-return'}]);
 fresh=await f.call(path,f.emp);assert.deepEqual(fresh.data.rows[0].slice(2,4),[12,3]);
 const page=(await f.call('/pos/catalog?registerId='+f.registerId,f.emp)).data.products[0];assert.deepEqual([page.onHand,page.reserved,page.available],[12,3,9]);
});

test('POS options can advertise background stock support without reading the full stock catalog', async () => {
 const f=await setup(),before=await f.db.select().from(stockMoves);
 for(const query of ['', '?stock=0']) {
  const boot=await f.call('/pos/options'+query,f.emp);assert.equal(boot.status,200);
  assert.equal(boot.data.stockSnapshotVersion,1);assert.equal(boot.data.stockSnapshot,undefined);
  assert.ok(boot.data.registers.some((r:{id:string})=>r.id===f.registerId));
 }
 const page=await f.call('/pos/catalog?registerId='+f.registerId+'&limit=20',f.emp);
 assert.equal(page.status,200);assert.ok(page.data.products.length<=20);assert.equal(page.data.products[0].available,10);
 assert.deepEqual(await f.db.select().from(stockMoves),before);
});

test('Lock and Minh Long preload have independent warehouses and catalog families; unopened is explicit',async()=>{
 const f=await setup();await f.db.insert(warehouses).values({id:'ml-stock',name:'Kho ML',kind:'stock'});
 const ml=await f.call('/pos/registers',f.mgr,'POST',{name:'Quầy Minh Long',warehouseId:'ml-stock',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'});assert.equal(ml.status,200);
 await f.db.insert(products).values([{sku:'LOCK-1',name:'Bình LocknLock',brand:'LocknLock',updatedAt:''},{sku:'ML-1',name:'Chén Minh Long',brand:'Minh Long',updatedAt:''}]);
 await f.db.insert(productPrices).values(['LOCK-1','ML-1'].map(sku=>({sku,policyId:'retail-vat',price:100})));
 await f.db.insert(productStock).values({sku:'ML-1',warehouseId:'ml-stock',quantity:99,updatedAt:''});
 let p=(await f.call('/pos/stock-snapshot?registerId='+ml.data.id,f.mgr)).data;assert.equal(p.warehouseReady,false);assert.ok(!p.rows.some((r:any)=>r[0]==='LOCK-1'));
 await postMoves(f.db as never,'mgr',[{sku:'ML-1',warehouseId:'ml-stock',qty:7,kind:'opening',refType:'opening',refId:'ml-opening'}]);
 p=(await f.call('/pos/stock-snapshot?registerId='+ml.data.id,f.mgr)).data;assert.equal(p.warehouseReady,true);assert.equal(p.rows.find((r:any)=>r[0]==='ML-1')[2],7);
 const lock=(await f.call('/pos/stock-snapshot?registerId='+f.registerId,f.emp)).data;assert.ok(!lock.rows.some((r:any)=>r[0]==='ML-1'));
 assert.equal((await f.call('/pos/stock-snapshot?registerId='+ml.data.id,f.emp)).status,403);
});

test('stock cache never substitutes unknown, another user/store/policy, or an older snapshot for current stock',()=>{
 let clock=0;const cache=createPosStockCache({now:()=>clock,ttl:15000}),a={version:1,registerId:'lock',warehouseId:'wl',pricePolicyId:'retail',asOf:'2026-11-01T00:00:00Z',warehouseReady:true,rows:[['A',100,7,2,['A','893']]]};
 assert.equal(cache.get('A','lock','retail','u'),null);assert.equal(cache.adopt(a,'u'),true);
 assert.equal(cache.get('A','lock','retail','u').available,5);assert.equal(cache.get('B','lock','retail','u'),null);assert.equal(cache.get('A','ml','retail','u'),null);assert.equal(cache.get('A','lock','other','u'),null);
 clock=16000;assert.equal(cache.get('A','lock','retail','u').available,5);assert.equal(cache.get('A','lock','retail','u').stockStale,true);
 assert.equal(cache.adopt({...a,asOf:'2026-10-31T00:00:00Z',rows:[['A',100,0,0,[]]]},'u'),false);assert.equal(cache.get('A','lock','retail','u').available,5);
 assert.equal(cache.get('A','lock','retail','v'),null);assert.equal(cache.get('A','lock','retail','u'),null,'switch account discards previous owner snapshots');
});

test('POS availability sums more than 5000 legacy reservations instead of silently truncating',async()=>{
 const f=await setup(),at=new Date().toISOString();
 await postMoves(f.db as never,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:5000,kind:'adjust',refType:'adjustment',refId:'large-fixture'}]);
 for(let offset=0;offset<5001;offset+=500){const ids=Array.from({length:Math.min(500,5001-offset)},(_,i)=>'bulk-hold-'+(offset+i));
  await f.db.insert(salesOrders).values(ids.map(id=>({id,orderNo:id,quoteType:'HRC' as const,customerName:'Fixture',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-01',warehouseId:'pos-wh',channel:'pos' as const,status:'confirmed' as const,holdsStock:true,total:1,createdAt:at,updatedAt:at})));
  await f.db.insert(salesOrderLines).values(ids.map(orderId=>({id:orderId+'-line',orderId,sku:'00123',name:'Ly',qty:1,unitPrice:1,amount:1,lineNo:1})));
 }
 const response=await f.call('/pos/stock-snapshot?registerId='+f.registerId,f.emp);assert.equal(response.status,200,JSON.stringify(response.data));assert.deepEqual(response.data.rows[0].slice(2,4),[5010,5001]);
});

test('compact stock refresh preserves searchable metadata; removed products disappear and unsupported data is rejected',()=>{
 const c=createPosStockCache(),a={version:1,registerId:'r',pricePolicyId:'p',asOf:'2026-11-01T00:00:00Z',warehouseReady:true,catalog:[{sku:'A',name:'Chén Minh Long',brand:'Minh Long',unit:'cái',pattern:'',imageUrl:''}],rows:[['A',100,7,1,[]]]};
 assert.equal(c.adopt(a,'u'),true);assert.equal(c.search('chen','r','p','u')[0].sku,'A');
 assert.equal(c.adopt({...a,catalog:undefined,asOf:'2026-11-01T00:01:00Z',rows:[['A',110,8,1,[]]]},'u'),true);assert.equal(c.search('chen','r','p','u').length,1);assert.equal(c.get('A','r','p','u').price,110);
 assert.equal(c.adopt({...a,version:2},'u'),false);assert.equal(c.adopt({...a,rows:[['A',100,NaN,0,[]]]},'u'),false);
 c.adopt({...a,catalog:undefined,asOf:'2026-11-01T00:02:00Z',rows:[]},'u');assert.equal(c.search('chen','r','p','u').length,0);
});
