import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {productionFixture,PDF} from '../helpers/production-files-fixture.ts';
import {productionFiles,productionFileLinks,salesOrders} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {productionFile,needsProductionFiles} from '../../src/modules/sales/domain/production-files.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('production formats and eligibility use Sale/logo/printing, never loosen ordinary file storage',()=>{
 assert.equal(needsProductionFiles({type:'HRC',rows:[{qty:2,printFee:5000}]} as any),false);assert.equal(needsProductionFiles({type:'B2B',template:'sale',rows:[]} as any),true);assert.equal(needsProductionFiles({type:'B2B',rows:[{qty:2,printFee:0,printDescription:'In logo 1 màu'}]} as any),true);
 assert.equal(productionFile('file.pdf',PDF).mime,'application/pdf');assert.equal(productionFile('file.ai',PDF).mime,'application/postscript');assert.throws(()=>productionFile('file.pdf',new TextEncoder().encode('MZ exe')));assert.throws(()=>productionFile('file.zip',PDF));assert.throws(()=>productionFile('../file.pdf',PDF));assert.throws(()=>productionFile('a.pdf',new Uint8Array(10*1024*1024+1)));
});
test('lost Drive reply retains durable pending metadata; same bytes/client retries do not create duplicate versions',async()=>{
 const f=await productionFixture(),q=await f.quote(),key=crypto.randomUUID();f.loseNextReply();ok(await f.upload(q,PDF,key),503);let rows=await f.db.select().from(productionFiles);assert.equal(rows.length,1);assert.equal(rows[0]!.status,'uploading');
 const r=ok(await f.upload(q,PDF,key));assert.match(ok(await f.call('/quotes/'+q.id,f.cookies.mgr,'DELETE',{revision:q.revision}),409).error,/file sản xuất/);assert.equal(r.file.status,'ready');assert.equal(f.remote.size,1);assert.equal(ok(await f.upload(q)).file.id,r.file.id);assert.equal((await f.db.select().from(productionFiles)).length,1);
 ok(await f.upload(q,new TextEncoder().encode('%PDF-1.7 different'),key),409);assert.equal(f.remote.size,1);
 const audit=await f.client.query<{data:string}>("select data from audit_logs where action='production-file-ready'");assert.ok(audit.rows.length);assert.ok(audit.rows.every(r=>!r.data.includes('production fixture')));
});
test('files bind atomically to orders and contracts, download is scoped, price and stock data remain unchanged',async()=>{
 const f=await productionFixture(),q=await f.quote(),file=ok(await f.upload(q)).file;
 const o=ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:q.id,pushSapo:false,productionFileIds:[file.id]}),201);
 const list=ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.emp));assert.equal(list.files[0].id,file.id);assert.equal(list.canAttach,true);
 const download=await f.request('/production-files/'+file.id+'/download',f.cookies.emp);assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),PDF);assert.match(download.headers.get('content-disposition')||'',/^attachment/);
 assert.equal((await f.request('/production-files/'+file.id+'/download',f.cookies.other)).status,404);assert.equal((await f.call('/orders/'+o.id+'/production-files',f.cookies.ncc)).status,403);
 const kq=await f.quote(),kf=ok(await f.upload(kq)).file,k=ok(await f.call('/contracts',f.cookies.emp,'POST',{quoteId:kq.id,legalEntity:'BN',pushSapo:false,productionFileIds:[kf.id]}),201);assert.equal(ok(await f.call('/orders/'+k.orderId+'/production-files',f.cookies.emp)).files[0].id,kf.id);
 const order=await f.db.select().from(salesOrders).where(eq(salesOrders.id,o.id));assert.equal(order[0]!.total,218160);assert.equal((await f.db.select().from(productionFileLinks)).length,2);
});
test('cross-quote, pending and stale revision attachments roll document creation back, required mode is enforced server-side',async()=>{
 const f=await productionFixture(),a=await f.quote(),b=await f.quote(),file=ok(await f.upload(a)).file;
 ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:b.id,pushSapo:false,productionFileIds:[file.id]}),409);assert.equal((await f.db.select().from(salesOrders)).length,0);
 await f.db.update(quotations).set({revision:a.revision+1}).where(eq(quotations.id,a.id));ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:a.id,pushSapo:false,productionFileIds:[file.id]}),409);assert.equal((await f.db.select().from(salesOrders)).length,0);
 f.env.productionFilesRequired=true;ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:b.id,pushSapo:false}),400);assert.equal((await f.db.select().from(salesOrders)).length,0);
 f.env.productionFilesRequired=false;ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:b.id,pushSapo:false}),201);
});
test('write-only-owner access, missing Drive, source revisions and later append preserve document permissions',async()=>{
 const f=await productionFixture(),q=await f.quote();ok(await f.upload(q,PDF,crypto.randomUUID(),f.cookies.other),404);assert.equal(f.calls.length,0);
 f.env.productionDrive=undefined;assert.equal(ok(await f.call('/quotes/'+q.id+'/production-files',f.cookies.emp)).configured,false);ok(await f.upload(q),503);
});

test('append follows order-edit rights, keeps previous versions and preserves references after cancellation/recreation',async()=>{
 const f=await productionFixture(),q=await f.quote(),o=ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:q.id,pushSapo:false}),201),a=ok(await f.upload(q)).file;
 ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.emp,'PUT',{productionFileIds:[a.id]}));
 const deletion=await f.call('/quotes/'+q.id,f.cookies.mgr,'DELETE',{revision:q.revision});ok(deletion,409);
 const b=ok(await f.upload(q,new TextEncoder().encode('%PDF-1.7 second version'))).file;await f.db.update(salesOrders).set({status:'confirmed'}).where(eq(salesOrders.id,o.id));
 ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.emp,'PUT',{productionFileIds:[b.id]}),403);ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.mgr,'PUT',{productionFileIds:[b.id]}));assert.equal(ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.emp)).files.length,2);
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,o.id));const next=ok(await f.call('/orders',f.cookies.emp,'POST',{quoteId:q.id,pushSapo:false,productionFileIds:[a.id]}),201);assert.equal(ok(await f.call('/orders/'+o.id+'/production-files',f.cookies.emp)).files.length,2);assert.equal(ok(await f.call('/orders/'+next.id+'/production-files',f.cookies.emp)).files.length,1);
 const sale=await f.quote({template:'sale',rows:[{name:'Ly sale',sku:'SALE-SKU',qty:1,price:100000,discount:0,designImage:true,image:'https://example.test/fixture.png'}]});assert.equal(ok(await f.call('/quotes/'+sale.id+'/production-files',f.cookies.emp)).eligible,true);
});
