import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff,PASSWORD} from '../helpers/staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines,salesContracts} from '../../src/modules/sales/schema.ts';
import {posReturns,posReturnLines} from '../../src/modules/sales/return-schema.ts';
import {autoQuoteHead,quoteHeadFor,nextQuoteNoAfter} from '../../src/modules/quotes/domain/quote-number.ts';
// @ts-ignore browser module
import {createSalePriceSuggestions,saleDesignProblem,SALE_LAYOUT_COLUMNS,saleSuggestionBatches,saleLineCell} from '../../trial-ui/sale-quote-layout.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function setup(){
 const f=await createTestDb();await seedStaff(f.d1);const router=createAppRouter(),files=memoryFileStore(),env={db:f.db,files,passwordIterations:1000,sapoOrderPush:'off' as const};
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie,emp=(await call('/login','','POST',{email:'emp@x.vn',password:PASSWORD})).cookie,ncc=(await call('/login','','POST',{email:'ncc@x.vn',password:PASSWORD})).cookie;
 return{...f,files,env,call,mgr,emp,ncc};
}
const doc=(no='SALE_BG_001_11112026')=>({type:'B2B',template:'sale',quoteNo:no,customer:'Khách giả lập',date:'2026-11-11',vat:8,rows:[{name:'Bình gốm',sku:'SKU',qty:10,price:100000,commission:{mode:'percent',value:0},printFee:5000,discount:0,image:'https://example.test/design-one.png',designImage:true,costPrice:123}]});
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
test('Sale requires explicit design on create/update/submit/approval, keeps eight columns and preserves old quote behavior',async()=>{
 const f=await setup();try{
  assert.equal(SALE_LAYOUT_COLUMNS.length,8);const bad=doc();delete (bad.rows[0] as any).image;
  for(const [i,cookie] of [f.emp,f.mgr].entries()){const draft=ok(await f.call('/quotes',cookie,'POST',{...bad,quoteNo:'SALE-INCOMPLETE-'+i}),201);assert.equal(draft.approvalStatus,'draft');assert.equal((await f.call('/quotes/'+draft.id+'/submit',cookie,'POST',{revision:1})).status,400);}
  assert.equal((await f.call('/quotes',f.emp,'POST',{...doc(),type:'HRC'})).status,400);
  assert.equal((await f.call('/quotes',f.emp,'POST',{...doc(),rows:[{...doc().rows[0],discount:5}]})).status,400);
  assert.equal(ok(await f.call('/quotes',f.emp,'POST',{...doc('SALE-UNCONFIRMED'),rows:[{...doc().rows[0],designImage:false}]}),201).approvalStatus,'draft');
  const q=ok(await f.call('/quotes',f.emp,'POST',doc()),201);assert.equal(q.approvalStatus,'draft');assert.equal(q.data.template,'sale');assert.ok(!('costPrice' in q.data.rows[0]));
  assert.ok(ok(await f.call('/quotes?type=SALE',f.emp)).quotes.some((r:any)=>r.id===q.id));assert.equal(ok(await f.call('/quotes?type=B2B',f.emp)).quotes.length,0);
  const draftUpdate=ok(await f.call('/quotes/'+q.id,f.mgr,'PUT',{revision:1,data:bad}));assert.equal(draftUpdate.approvalStatus,'draft');
  await f.db.update(quotations).set({revision:1}).where(eq(quotations.id,q.id));
  const broken={...q.data,rows:[{...q.data.rows[0],image:'',designImage:false}]};await f.db.update(quotations).set({data:JSON.stringify(broken)}).where(eq(quotations.id,q.id));
  assert.equal((await f.call('/quotes/'+q.id+'/submit',f.emp,'POST',{revision:1})).status,400);
  assert.equal((await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1})).status,400);
  await f.db.update(quotations).set({data:JSON.stringify(q.data)}).where(eq(quotations.id,q.id));
  ok(await f.call('/quotes/'+q.id+'/submit',f.emp,'POST',{revision:1}));ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
  assert.equal((await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:9})).status,409);
  const old={...doc('B2B-BASIC'),template:undefined,rows:[{name:'Không cần ảnh',qty:1,price:1}]};assert.equal(ok(await f.call('/quotes',f.mgr,'POST',old),201).approvalStatus,'approved');
  const head=quoteHeadFor('SALE','2026-11-11');assert.equal(nextQuoteNoAfter(head,['SALE_BG_001_11112026']),'SALE_BG_002_11112026');assert.equal(autoQuoteHead('SALE_BG_001_11112026'),head);
 }finally{/* createTestDb registers automatic cleanup. */}
});
test('private design uploads remain isolated from catalogue and other quotes, validate bytes/keys, and never persist signed URLs',async()=>{
 const f=await setup();try{
  await f.db.insert(products).values({sku:'SKU',name:'Sản phẩm',imageUrl:'https://example.test/original.jpg',updatedAt:new Date().toISOString()});
  const a=ok(await f.call('/quotes/design-images',f.emp,'POST',{image:PNG}),201),b=ok(await f.call('/quotes/design-images',f.mgr,'POST',{image:PNG}),201);
  assert.notEqual(a.key,b.key);assert.ok(f.files.files.has(a.key));assert.match(a.key,/^quote-designs\/emp\//);assert.ok(!('publicUrl' in a));
  assert.equal((await f.call('/quotes/design-images',f.emp,'POST',{image:'data:image/png;base64,YWJjZA=='})).status,415);
  assert.equal((await f.call('/quotes/design-images','','POST',{image:PNG})).status,401);assert.equal((await f.call('/quotes/design-images',f.ncc,'POST',{image:PNG})).status,403);
  const withKey=(base:any,upload:any)=>({...base,rows:[{...base.rows[0],image:upload.imageUrl,designImageKey:upload.key}]});
  assert.equal((await f.call('/quotes',f.emp,'POST',withKey(doc('SALE-FORBIDDEN'),b))).status,403);
  const qa=ok(await f.call('/quotes',f.emp,'POST',withKey(doc('SALE-ONE'),a)),201),qb=ok(await f.call('/quotes',f.mgr,'POST',withKey(doc('SALE-TWO'),b)),201);
  const stored=JSON.parse((await f.db.select().from(quotations).where(eq(quotations.id,qa.id)))[0]!.data);assert.equal(stored.rows[0].image,'');assert.equal(stored.rows[0].designImageKey,a.key);
  assert.ok(!JSON.stringify(stored).includes('base64'));assert.equal(ok(await f.call('/quotes/'+qa.id,f.emp)).data.rows[0].image,PNG);
  assert.equal((await f.call('/quotes/'+qb.id,f.emp)).status,404,'quote scope gates signing another user design');
  const modified={...qa.data,rows:[{...qa.data.rows[0],image:'https://example.test/new-design.png',designImageKey:undefined}]};
  ok(await f.call('/quotes/'+qa.id,f.emp,'PUT',{revision:1,data:modified}));
  assert.equal(ok(await f.call('/quotes/'+qb.id,f.mgr)).data.rows[0].designImageKey,b.key);
  assert.equal((await f.db.select().from(products).where(eq(products.sku,'SKU')))[0]!.imageUrl,'https://example.test/original.jpg');
  assert.equal(saleDesignProblem({template:'sale',rows:[{image:'',designImage:true}]}).length>0,true);
  const sign=f.files.signedUrls;f.files.signedUrls=async()=>{throw Error('Synthetic storage outage');};
  const failed=await f.call('/quotes',f.emp,'POST',withKey(doc('SALE-STORAGE-FAILED'),a));assert.equal(failed.status,500);
  assert.equal((await f.db.select().from(quotations).where(eq(quotations.quoteNo,'SALE-STORAGE-FAILED'))).length,0,'do not commit a quote then return a storage failure');f.files.signedUrls=sign;
 }finally{/* createTestDb registers automatic cleanup. */}
});
test('batch price suggestions use six-month scoped net sales snapshots, exclude print/VAT and effective returns, never the movement cache',async()=>{
 const f=await setup();try{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),now=new Date().toISOString();
  await f.db.insert(warehouses).values({id:'wh',name:'Kho thử',kind:'stock'});
  const add=async(id:string,qty:number,price:number,opt:{owner?:string;channel?:string;date?:string;status?:'draft'|'cancelled';missing?:boolean}={})=>{
   await f.db.insert(salesOrders).values({id,orderNo:'ORDER-'+id,channel:opt.channel||'crm',quoteType:'B2B',ownerId:opt.owner||'emp',createdBy:opt.owner||'emp',customerName:'Fixture',orderDate:opt.date||date,status:opt.status||'confirmed',subtotal:qty*(price+50),total:qty*(price+50),createdAt:now,updatedAt:now,holdsStock:false});
   await f.db.insert(salesOrderLines).values({id:'line-'+id,orderId:id,lineNo:1,sku:'SKU',name:'Ly',qty,unitPrice:opt.channel==='pos'?price:price+50,listUnitPrice:opt.missing?null:price+20,discountAmount:20*qty,taxRate:8,amount:qty*(price+50)});
  };
  await add('a',1,100);await add('b',3,200);await add('pos',2,50,{channel:'pos'});await add('secret',10,999,{owner:'mgr'});await add('old',10,999,{date:'2020-01-01'});await add('future',10,999,{date:'2099-01-01'});await add('cancelled',10,999,{status:'cancelled'});await add('draft',10,999,{status:'draft'});await add('missing',10,999,{missing:true});
  await f.db.insert(posReturns).values({id:'ret',returnNo:'RET',source:'crm',orderId:'b',warehouseId:'wh',requestContext:'after_delivery',kind:'return',status:'completed',reason:'Synthetic credit',subtotal:250,tax:20,total:270,sourceSnapshot:'{}',requestKey:'ret-key',createdBy:'mgr',createdAt:now,updatedAt:now,creditEffectiveAt:now});
  await f.db.insert(posReturnLines).values({id:'ret-line',returnId:'ret',orderLineId:'line-b',sku:'SKU',name:'Ly',unit:'Cái',disposition:'restock',requestedQty:1,subtotal:250,tax:20,total:270});
  let own=ok(await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU&sku=UNKNOWN',f.emp));assert.equal(own.prices.length,1);assert.equal(own.prices[0].average,120);assert.equal(own.prices[0].quantity,5);assert.equal(own.prices[0].orders,3);assert.equal(own.basis,'weighted-net-excluding-print');assert.ok(own.from<date);assert.equal(own.to,date);assert.ok(!JSON.stringify(own).includes('costPrice'));
  const all=ok(await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU',f.mgr));assert.equal(all.prices[0].average,(600+9990)/15);
  // More than twenty sales; no retention-bound product_movements data is used.
  for(let i=0;i<22;i++)await add('history-'+i,1,120);
  own=ok(await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU',f.emp));assert.equal(own.prices[0].average,120);assert.equal(own.prices[0].orders,25);
  await add('signed',1,390,{status:'draft'});await f.db.insert(salesContracts).values({id:'signed-contract',orderId:'signed',contractNo:'HDKT-SIGNED',legalEntity:'BN',status:'signed',createdBy:'emp',createdAt:now,updatedAt:now});
  const signed=ok(await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU',f.emp));assert.equal(signed.prices[0].average,(120*27+390)/28);
  for(const query of ['', '?sku=', '?'+Array.from({length:301},()=> 'sku=SKU').join('&')])assert.equal((await f.call('/products/quote-tools/sale-price-suggestions'+query,f.emp)).status,400);
  assert.equal((await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU')).status,401);assert.equal((await f.call('/products/quote-tools/sale-price-suggestions?sku=SKU',f.ncc)).status,403);
 }finally{/* createTestDb registers automatic cleanup. */}
});
test('UI batches price lookups, deduplicates repeated renders, contains failures and discards responses across users',async()=>{
 let calls=0,resolve:any;const requests:string[]=[];const loader=createSalePriceSuggestions({api:async(path:string)=>{calls++;requests.push(path);return new Promise(r=>resolve=r);},changed:()=>{}});
 for(let i=0;i<20;i++)loader.request('first',[{sku:'A'},{sku:'B'},{sku:'A'}]);
 await new Promise(r=>setTimeout(r,190));assert.equal(calls,1);assert.equal(new URL('https://test'+requests[0]).searchParams.getAll('sku').length,2);
 loader.request('second',[{sku:'C'}]);resolve({from:'2026-05-11',to:'2026-11-11',prices:[{sku:'A',average:999,orders:1}]});await new Promise(r=>setTimeout(r,190));assert.equal(calls,2);
 resolve({from:'2026-05-11',to:'2026-11-11',prices:[]});await new Promise(r=>setTimeout(r,10));assert.doesNotMatch(loader.view('A',{esc:String,money:String}),/999/);assert.match(loader.view('C',{esc:String,money:String}),/Chưa đủ/);
 for(let i=0;i<20;i++)loader.request('second',[{sku:'C'}]);await new Promise(r=>setTimeout(r,190));assert.equal(calls,2);
});

test('employee quote exposes editable customer rebate; costs, print costs, margin and other quotes remain private',async()=>{
 const f=await setup();const made=ok(await f.call('/quotes',f.emp,'POST',{...doc('STAFF-SUMMARY'),template:undefined}),201);
 const stored=ok(await f.call('/quotes/'+made.id,f.mgr));stored.data.rows[0]={...stored.data.rows[0],costPrice:40000,purchaseDiscount:60,commission:{mode:'amount',value:2000},printing:{unitPrice:500}};
 ok(await f.call('/quotes/'+made.id,f.mgr,'PUT',{revision:1,data:stored.data}));
 const visible=ok(await f.call('/quotes/'+made.id,f.emp));assert.deepEqual(visible.data.staffSummary,{customerCommission:20000});
 for(const key of ['costPrice','purchaseDiscount','printing'])assert.equal(visible.data.rows[0][key],undefined);
 assert.equal(visible.data.printing,undefined);for(const key of ['gross','margin','cost'])assert.equal(visible.data.staffSummary[key],undefined);
 visible.data.staffSummary.customerCommission=999999;visible.data.rows[0].costPrice=1;
 const saved=ok(await f.call('/quotes/'+made.id,f.emp,'PUT',{revision:2,data:visible.data}));assert.equal(saved.data.staffSummary.customerCommission,20000);
 const after=ok(await f.call('/quotes/'+made.id,f.mgr));assert.equal(after.data.rows[0].costPrice,40000);assert.equal(after.data.rows[0].printing.unitPrice,500);
 const secret=ok(await f.call('/quotes',f.mgr,'POST',{...doc('SECRET-SUMMARY'),template:undefined}),201);assert.equal((await f.call('/quotes/'+secret.id,f.emp)).status,404);
});

test('300-SKU lookups use bounded batches, retaining every SKU without oversized URLs',()=>{
 const skus=Array.from({length:300},(_,i)=>String(i)+'A'.repeat(60)),batches=saleSuggestionBatches(skus);
 assert.deepEqual(batches.flat(),skus);assert.ok(batches.length<10);for(const batch of batches)assert.ok(batch.map((s:string)=>'sku='+encodeURIComponent(s)).join('&').length<6000);
});

test('Sale rows expose the three escaped, editable description fields inside the existing product column',()=>{
 const row={name:'Ly',sku:'LG-143509',brand:'Lucky Thái Lan',materialDescription:'Thủy tinh <script>',brandDescription:'Lucky Thái Lan',volumeDescription:'255ml',printDescription:'Logo "A"',packagingDescription:'Hộp riêng'};
 const esc=(v:unknown)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const html=saleLineCell(row,0,{esc,fmtNum:String,image:()=>'',average:()=>''});
 assert.equal((html.match(/<td /g)||[]).length,8);
 for(const key of ['materialDescription','brandDescription','volumeDescription','printDescription','packagingDescription'])assert(html.includes('data-k="'+key+'"'));
 assert(html.includes('Thủy tinh &lt;script&gt;'));assert(html.includes('Logo &quot;A&quot;'));assert(!html.includes('<script>'));
 const old=saleLineCell({name:'Báo giá cũ'},0,{esc,fmtNum:String,image:()=>'',average:()=>''});assert.match(old,/data-k="packagingDescription"[^>]*>theo tiêu chuẩn nhà sản xuất<\/textarea>/);
});

test('Sale description values survive create/read/update without changing pricing or approval rules',async()=>{
 const f=await setup(),data=doc('SALE-DESCRIPTIONS');Object.assign(data.rows[0]!,{brand:'Thương hiệu gốc',materialDescription:'Thủy tinh',brandDescription:'Lucky Thái Lan',volumeDescription:'255ml',printDescription:'Logo xanh',packagingDescription:'Hộp carton'});
 const q=ok(await f.call('/quotes',f.emp,'POST',data),201);const loaded=ok(await f.call('/quotes/'+q.id,f.emp));
 for(const key of ['materialDescription','brandDescription','volumeDescription','printDescription','packagingDescription'])assert.equal(loaded.data.rows[0][key],(data.rows[0] as any)[key]);
 const edited={...loaded.data,rows:loaded.data.rows.map((r:any)=>({...r,volumeDescription:'300ml',packagingDescription:''}))};
 ok(await f.call('/quotes/'+q.id,f.emp,'PUT',{revision:1,data:edited}));const saved=ok(await f.call('/quotes/'+q.id,f.emp));
 assert.equal(saved.data.rows[0].volumeDescription,'300ml');assert.equal(saved.data.rows[0].brand,'Thương hiệu gốc');assert.equal(saved.data.rows[0].packagingDescription,'');assert.equal(saved.data.rows[0].price,q.data.rows[0].price);assert.equal(saved.data.rows[0].qty,q.data.rows[0].qty);assert.equal(saved.data.rows[0].printFee,q.data.rows[0].printFee);assert.equal(saved.approvalStatus,'draft');
 for(const field of ['materialDescription','brandDescription','volumeDescription'])assert.equal((await f.call('/quotes',f.emp,'POST',{...data,quoteNo:'SALE-LIMIT-'+field,rows:[{...data.rows[0],[field]:'x'.repeat(2001)}]})).status,400);
});
