import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {productPrices} from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {shortMemo,invalidateShortMemos} from '../../src/core/cache/short-memo.ts';
const {createPosStockCache}:any=await import(new URL('../../trial-ui/pos-stock-cache.js',import.meta.url).href);

test('POS stock delta: only changed stock + all reservations; catalog/price change or stale since forces a full reload; no writes',async()=>{
 const f=await setup(),before=(await f.db.select().from(stockMoves)).length,path='/pos/stock-snapshot?registerId='+f.registerId;
 const full=(await f.call(path,f.emp)).data;assert.equal(typeof full.base,'string');assert.ok(full.base.length>8,'full snapshot carries the catalog/price base');
 const q=(since:string,base:string)=>f.call(path+'&since='+encodeURIComponent(since)+'&base='+encodeURIComponent(base),f.emp);
 // Không có gì đổi trong 60 giây chồng lấn trước đó ngoài tồn đầu kỳ của fixture → chỉ trả các dòng tồn mới ghi.
 const later=new Date(Date.now()+2*60_000).toISOString();
 let d=(await q(later,full.base)).data;assert.equal(d.delta,true);assert.deepEqual(d.rows,[],'nothing changed after since');assert.deepEqual(d.held,[]);
 await postMoves(f.db as never,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:2,kind:'customer_return',refType:'pos_return',refId:'delta-return'}]);
 d=(await q(full.asOf,full.base)).data;assert.equal(d.delta,true);assert.deepEqual(d.rows.map((r:any)=>r.slice(0,4)),[['00123',108000,12,0]],'changed sku only');
 await f.db.insert(salesOrders).values({id:'hold',orderNo:'HOLD',quoteType:'HRC',customerName:'Test',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-01',warehouseId:'pos-wh',channel:'pos',status:'confirmed',holdsStock:true,total:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 await f.db.insert(salesOrderLines).values({id:'hold-line',orderId:'hold',sku:'00123',name:'Ly',qty:3,unitPrice:1,amount:3,lineNo:1});
 d=(await q(later,full.base)).data;assert.deepEqual(d.rows,[]);assert.deepEqual(d.held,[['00123',3]],'reservations are always complete even without a stock write');
 await f.db.update(productPrices).set({price:99000}).where(eq(productPrices.sku,'00123'));
 assert.deepEqual((await q(full.asOf,full.base)).data,{version:1,full:true},'price change → full reload');
 const fresh=(await f.call(path,f.emp)).data;assert.notEqual(fresh.base,full.base);
 assert.deepEqual((await q(new Date(Date.now()-11*60_000).toISOString(),fresh.base)).data,{version:1,full:true},'since older than 10 minutes → full reload');
 assert.deepEqual((await q('not-a-date',fresh.base)).data,{version:1,full:true});
 assert.equal((await q(fresh.asOf,fresh.base)).status,200);
 assert.equal((await f.call(path+'&since='+encodeURIComponent(fresh.asOf)+'&base=x',f.ncc)).status,403,'permission still enforced');
 assert.equal((await f.call(path+'&pricePolicyId=other&since='+encodeURIComponent(fresh.asOf)+'&base=x',f.emp)).status,400);
 assert.equal((await f.db.select().from(stockMoves)).length,before+1,'delta reads never write stock');
});

test('POS cache merges a delta onto the same base and refuses anything it cannot apply safely',()=>{
 const c=createPosStockCache(),base={version:1,base:'B1',registerId:'r',pricePolicyId:'p',warehouseId:'w',asOf:'2026-11-19T10:00:00.000Z',warehouseReady:true,
  rows:[['A',100,10,2,['A']],['B',50,5,0,['B','893']]]};
 assert.equal(c.adopt(base,'u'),true);
 const delta={version:1,delta:true,base:'B1',registerId:'r',pricePolicyId:'p',warehouseId:'w',asOf:'2026-11-19T10:00:30.000Z',warehouseReady:true,rows:[['B',50,3,0,['B','893']]],held:[['B',1]]};
 assert.equal(c.merge(delta,'u'),true);
 const a=c.get('A','r','p','u'),b=c.get('B','r','p','u');
 assert.deepEqual([a.onHand,a.reserved,a.available],[10,0,10],'A unchanged stock, its hold released');
 assert.deepEqual([b.onHand,b.reserved,b.available],[3,1,2]);assert.deepEqual(b.scanCodes,['B','893']);
 assert.equal(c.scope('r','p','u').asOf,delta.asOf);
 assert.equal(c.merge({...delta,base:'B2'},'u'),false,'different catalog/price base');
 assert.equal(c.merge({...delta,asOf:'2026-11-19T09:59:00.000Z'},'u'),false,'older than what is held');
 assert.equal(c.merge({...delta,asOf:'2026-11-19T10:01:00.000Z',rows:[['NEW',1,1,0,[]]]},'u'),false,'unknown product needs catalog metadata');
 assert.equal(c.merge({...delta,registerId:'other'},'u'),false,'no snapshot for another register');
 assert.equal(c.merge(delta,'someone-else'),false,'another user starts empty');
});

test('short memo shares one in-flight read, expires, drops failures and is cleared by writes',async()=>{
 let t=0,calls=0;const m=shortMemo<number>({ttlMs:5000,now:()=>t});
 const load=async()=>++calls;
 assert.deepEqual(await Promise.all([m.get('k',load),m.get('k',load)]),[1,1]);
 t=4999;assert.equal(await m.get('k',load),1);t=5000;assert.equal(await m.get('k',load),2);
 invalidateShortMemos();assert.equal(await m.get('k',load),3);
 await assert.rejects(m.get('bad',async()=>{throw new Error('x');}));assert.equal(await m.get('bad',async()=>7),7,'failure not cached');
 const off=shortMemo<number>({ttlMs:0});let n=0;await off.get('k',async()=>++n);await off.get('k',async()=>++n);assert.equal(n,2,'ttl 0 disables');
});
