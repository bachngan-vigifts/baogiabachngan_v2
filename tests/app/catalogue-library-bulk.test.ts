import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
import {catalogueLibrary as lib,catalogueLibraryCommands as commands,catalogueQuotes} from '../../src/modules/catalog/catalogue-library-schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
// @ts-expect-error browser JS module
import {defaultState,validateProduct} from '../../trial-ui/catalogue/core.js';
const product={name:'Bộ trà',sku:'00123',brand:'Minh Long',category:'Bộ trà',collection:'Camellia',pattern:'Sen',color:'Trắng',regular:100000};
async function fixture(){const f=await setupWarehouseWork();const r=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'one',product},{clientId:'two',product:{...product,sku:'00124'}}]});assert.equal(r.status,200);return{...f,rows:r.data.products,bulk:(body:unknown,cookie=f.cookies.emp)=>f.call('/catalogue-library/bulk',cookie,'POST',body)};}
const items=(f:Awaited<ReturnType<typeof fixture>>)=>f.rows.map((r:any)=>({id:r.id,revision:r.revision}));
test('bulk metadata edits apply only requested fields; command replay survives later single-product edits',async()=>{
 const f=await fixture(),body={action:'edit',clientKey:crypto.randomUUID(),items:items(f),patch:{collection:'Dùng chung'}};const r=await f.bulk(body);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.count,2);
 const [a]=r.data.products;assert.equal((await f.call('/catalogue-library/'+a.id,f.cookies.kt,'PUT',{revision:a.revision,clientKey:crypto.randomUUID(),product:{...a.product,name:'Đã sửa riêng'}})).status,200);
 const replay=await f.bulk({...body,items:[...body.items].reverse()});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);const rows=await f.db.select().from(lib);assert(rows.every(r=>r.collection==='Dùng chung'&&r.color==='Trắng'));assert.equal(rows.find(r=>r.id===a.id)!.name,'Đã sửa riêng');assert.equal((await f.db.select().from(commands)).length,1);assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action,'catalogue-library-bulk-edit'))).length,2);
 assert.equal((await f.bulk({...body,patch:{color:'Đỏ'}})).status,409);
});
test('one stale product rolls back the entire batch and command; identities, duplicates and unauthorised requests rejected',async()=>{
 const f=await fixture(),a=f.rows[0];await f.call('/catalogue-library/'+a.id,f.cookies.kt,'PUT',{revision:a.revision,clientKey:crypto.randomUUID(),product:{...a.product,color:'Vàng'}});
 const b={action:'edit',clientKey:crypto.randomUUID(),items:items(f),patch:{category:'Ly sứ'}};assert.equal((await f.bulk(b)).status,409);assert((await f.db.select().from(lib)).every(r=>r.category==='Bộ trà'));assert.equal((await f.db.select().from(commands)).length,0);
 assert.equal((await f.bulk({...b,items:[b.items[0],b.items[0]]})).status,400);assert.equal((await f.bulk({...b,patch:{sku:'hijack'}})).status,400);assert.equal((await f.bulk({...b,items:Array(101).fill(b.items[0])})).status,400);assert.equal((await f.bulk(b,f.cookies.ncc)).status,403);assert.equal((await f.call('/catalogue-library/bulk','','POST',b)).status,401);
});
test('archive hides products and facets, keeps quote snapshots and source identity, and restores the same products',async()=>{
 const f=await fixture(),s=defaultState();s.products=f.rows.map((r:any)=>validateProduct({...r.product,id:r.id,sharedId:r.id,sharedRevision:r.revision,discount:10,fee:15000,qty:7,override:88888}));s.selected=s.products.map((p:any)=>p.id);const q=await f.call('/catalogue-quotes',f.cookies.emp,'POST',{id:crypto.randomUUID(),clientKey:crypto.randomUUID(),state:s});assert.equal(q.status,200,JSON.stringify(q.data));const before=(await f.db.select().from(catalogueQuotes))[0]!.data;
 const body={action:'archive',clientKey:crypto.randomUUID(),items:items(f)};const r=await f.bulk(body);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal((await f.call('/catalogue-library',f.cookies.kt)).data.total,0);assert.deepEqual((await f.call('/catalogue-library',f.cookies.kt)).data.facets.category,[]);assert.equal((await f.call('/catalogue-library?archived=1',f.cookies.kt)).data.total,2);assert.equal((await f.bulk(body)).data.replayed,true);
 const imported=await f.call('/catalogue-library',f.cookies.kt,'POST',{products:[{clientId:'again',product}]});assert.equal(imported.data.products.length,0);assert.equal(imported.data.errors.length,1);assert.equal((await f.db.select().from(lib)).length,2);
 const restore=await f.bulk({action:'restore',clientKey:crypto.randomUUID(),items:r.data.products.map((p:any)=>({id:p.id,revision:p.revision}))},f.cookies.kt);assert.equal(restore.status,200,JSON.stringify(restore.data));assert.equal((await f.call('/catalogue-library',f.cookies.kt)).data.total,2);assert.equal((await f.db.select().from(catalogueQuotes))[0]!.data,before);
});
test('concurrent bulk commands cannot overwrite another employee or deadlock on reversed selection', {skip:!process.env.TEST_PG_URL},async()=>{
 const f=await fixture(),body={action:'edit',clientKey:crypto.randomUUID(),items:items(f),patch:{pattern:'Mới'}};const create=()=>f.bulk(body);const a=await Promise.all([create(),create()]);assert.deepEqual(a.map(r=>r.status),[200,200]);assert.equal(a.filter(r=>r.data.replayed).length,1);
 const now=a[0]!.data.products.map((r:any)=>({id:r.id,revision:r.revision}));const b=await Promise.all([f.bulk({...body,clientKey:crypto.randomUUID(),items:now,patch:{color:'Xanh'}}),f.bulk({...body,clientKey:crypto.randomUUID(),items:[...now].reverse(),patch:{color:'Đỏ'}},f.cookies.kt)]);assert.deepEqual(b.map(r=>r.status).sort(),[200,409]);assert.equal((await f.db.select().from(commands)).length,2);
});
