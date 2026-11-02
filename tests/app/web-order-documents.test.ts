import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders,deliveries} from '../../src/modules/sales/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
const address={addressLine:'12 Hai Bà Trưng',provinceId:220,provinceName:'Cần Thơ',districtId:1574,districtName:'Quận Ninh Kiều',wardCode:'550307',wardName:'Phường Tân An'};
async function fixture(){
 const f=await setup();await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const body={id:21569,number:'21569',status:'pending',total:'216000',currency:'VND',billing:{first_name:'Khách A',phone:'0901234567'},line_items:[{sku:'00123',name:'Ly sứ',quantity:2,subtotal:'200000',subtotal_tax:'16000',total:'200000',total_tax:'16000'}],shipping_total:'0',shipping_tax:'0',discount_total:'0',discount_tax:'0',total_tax:'16000',coupon_lines:[],fee_lines:[],shipping_lines:[],date_paid_gmt:null,date_created_gmt:'2026-11-02T05:00:00Z'};
 const sync=(extra:object={})=>f.call('/integrations/woocommerce/lock/order?token=test-lock-token','','POST',{...body,...extra});
 assert.equal((await sync()).status,200);const [o]=await f.db.select().from(web);const id='web:'+o!.id;
 const detail=async()=>{const r=await f.call('/orders/'+encodeURIComponent(id),f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const cart={lines:[{sku:'00123',qty:1,unitPrice:108000,taxRate:8,discountType:'amount',discountValue:0}],orderDiscount:0,shippingFee:0,feeAmount:0};
 const edit=async(d:any,patch:object={})=>{const p=await f.call('/orders/'+encodeURIComponent(id)+'/web/preview',f.mgr,'POST',{...cart,...patch});assert.equal(p.status,200,JSON.stringify(p.data));return f.call('/orders/'+encodeURIComponent(id)+'/web-edit',f.mgr,'PUT',{...cart,...patch,clientKey:crypto.randomUUID(),revision:d.revision,sourceHash:d.sourceHash,expectedTotal:p.data.total,pricingReviewed:true,paymentReviewed:true,reason:'Đổi hàng theo khách'});};
 return{...f,id,webId:o!.id,sync,detail,cart,edit};
}
test('web intake appears in /orders with Web_<source number>_<customer>; detail is one linked web identity without new order/stock/payment',async()=>{
 const f=await fixture(),before=(await f.db.select().from(salesOrders)).length;
 const r=await f.call('/orders?flow=order&source=web',f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.total,1);assert.equal(r.data.orders[0].id,f.id);assert.equal(r.data.orders[0].orderNo,'Web_21569_Khách A');
 const d=await f.detail();assert.equal(d.canEdit,true);assert.equal(d.items[0].totalTax,16000);assert.equal(d.editor.lines[0].unitPrice,108000);assert.equal(d.editor.lines[0].discountValue,0);
 assert.equal((await f.db.select().from(salesOrders)).length,before);assert.equal((await f.db.select().from(deliveries)).length,0);
 const blocked=await f.call('/orders/'+encodeURIComponent(f.id)+'/status',f.mgr,'PUT',{status:'delivered'});assert.ok(blocked.status>=400&&blocked.status<500,'virtual identity cannot invoke regular financial/stock mutations');
 assert.equal((await f.call('/orders?source=web&owner=mgr',f.mgr)).data.total,0,'unassigned web order does not match owner');
});
test('edit is revision/hash checked; webhook cannot overwrite local cart; GHN receives edited SKU/amount in correct Lock account',async()=>{
 const f=await fixture();await f.db.insert(products).values({sku:'ALT',name:'Hàng thay thế',unit:'Bộ',updatedAt:'2026-11-02'});await postMoves(f.db,'mgr',[{sku:'ALT',warehouseId:'pos-wh',qty:10,kind:'opening',refType:'opening',refId:'alt-opening'}]);
 const d=await f.detail(),patch={lines:[{...f.cart.lines[0],sku:'ALT'}]};
 const saved=await f.edit(d,patch);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.document.total,108000);assert.equal(saved.data.revision,1);assert.equal(saved.data.items[0].sku,'ALT');
 const stale=await f.edit(d,patch);assert.equal(stale.status,409);assert.equal(stale.data.code,'WEB_ORDER_CHANGED');
 await f.sync();let next=await f.detail();assert.equal(next.items[0].sku,'ALT');assert.equal(next.document.total,108000);
 const sent:any[]=[];f.env.ghnToken='test-lock-only';f.env.ghnFetch=async(url,init)=>{sent.push({url:String(url),body:JSON.parse(String(init?.body)),headers:init?.headers});return Response.json({code:200,data:{order_code:'EDIT21569',total_fee:20000}});};
 const made=await f.call('/pos/web-orders/'+f.webId+'/action',f.mgr,'POST',{action:'confirm',...address,webRevision:1,codAmount:108000,ghnWeight:1000,ghnRequiredNote:'KHONGCHOXEMHANG'});
 assert.equal(made.status,200,JSON.stringify(made.data));assert.equal(sent.length,1);assert.equal(sent[0].headers.ShopId,'6096731');assert.equal(sent[0].body.client_order_code,'21569');assert.equal(sent[0].body.items[0].code,'ALT');assert.equal(sent[0].body.cod_amount,108000);
 next=await f.detail();assert.equal(next.canEdit,false);assert.equal(next.document.ghnOrderCode,'EDIT21569');assert.equal((await f.call('/orders/'+encodeURIComponent(f.id)+'/web-edit',f.mgr,'PUT',{...f.cart,clientKey:crypto.randomUUID(),revision:next.revision,sourceHash:next.sourceHash})).status,409);
 await f.sync({meta_data:[{key:'_lnl_ghn_order_code',value:'EDIT21569'},{key:'_lnl_ghn_last_status',value:'picked'}]});
 const moves=await f.db.select().from(stockMoves).where(eq(stockMoves.refId,f.webId));assert.equal(moves.length,1);assert.equal(moves[0]!.sku,'ALT');assert.equal(moves[0]!.qty,-1);
 await f.sync({meta_data:[{key:'_lnl_ghn_order_code',value:'EDIT21569'},{key:'_lnl_ghn_last_status',value:'picked'}]});assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,f.webId))).length,1);
});
test('unknown GHN freezes edited cart and retries reconcile without another create; source changes remain visible as conflict',async()=>{
 const f=await fixture();assert.equal((await f.edit(await f.detail())).status,200);
 let creates=0;f.env.ghnToken='test-lock-only';f.env.ghnFetch=async(url)=>{if(String(url).endsWith('/create')){creates++;throw new Error('lost response');}return Response.json({code:404,message:'not found'},{status:404});};
 const confirm=()=>f.call('/pos/web-orders/'+f.webId+'/action',f.mgr,'POST',{action:'confirm',...address,webRevision:1,codAmount:108000,ghnWeight:1000,ghnRequiredNote:'KHONGCHOXEMHANG'});
 assert.equal((await confirm()).status,504);assert.equal((await confirm()).status,504);assert.equal(creates,1,'no new create after unknown result');
 const d=await f.detail();assert.equal(d.canEdit,false);assert.match(d.editBlocked,/đối soát/);
 await f.sync({total:'230000'});const changed=await f.detail();assert.equal(changed.document.total,108000);assert.equal(changed.document.sourceConflict,true);
});
test('combined pagination, full-number search, unknown-payment summary, replay/conflict and source naming remain consistent',async()=>{
 const f=await fixture();await f.db.insert(salesOrders).values({id:'regular',orderNo:'DH-regular',quoteType:'HRC',customerName:'CRM buyer',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-02',createdAt:'2026-11-02T06:00:00Z',updatedAt:'2026-11-02T06:00:00Z',total:1000,holdsStock:false});
 const list=async(q:string)=>{const r=await f.call('/orders?flow=order&'+q,f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const first=await list('limit=1'),second=await list('limit=1&offset=1');assert.equal(first.total,2);assert.equal(first.orders[0].id,'regular');assert.equal(second.orders[0].id,f.id);assert.deepEqual(first.summary,second.summary);
 assert.equal((await list('q=Web_21569_Khách%20A')).orders[0].id,f.id);
 assert.equal((await list('source=crm')).total,1);assert.equal((await list('source=web')).total,1);assert.equal((await list('source=ghn')).total,0,'website rows without carrier code stay in web source filter');
 const d=await f.detail(),preview=(await f.call('/orders/'+encodeURIComponent(f.id)+'/web/preview',f.mgr,'POST',f.cart)).data;
 const body={...f.cart,clientKey:crypto.randomUUID(),revision:d.revision,sourceHash:d.sourceHash,expectedTotal:preview.total,pricingReviewed:true,paymentReviewed:true,reason:'Đổi giỏ hàng có chủ đích'};
 const put=(b:object)=>f.call('/orders/'+encodeURIComponent(f.id)+'/web-edit',f.mgr,'PUT',b);
 assert.equal((await put(body)).status,200);const replay=await put(body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.revision,1);
 assert.equal((await put({...body,orderDiscount:1})).data.code,'COMMAND_CONFLICT');
 await f.sync({billing:{first_name:'Tên mới',phone:'0901234567'}});assert.equal((await f.detail()).document.orderNo,'Web_21569_Khách A','CRM number is not renamed by later customer updates');
});
test('paid orders cannot change collected total, and store employees cannot read/edit another store',async()=>{
 const f=await fixture();await f.sync({date_paid_gmt:'2026-11-02T05:30:00Z'});
 assert.equal((await f.edit(await f.detail())).data.code,'PAID_WEB_ORDER_REVIEW_REQUIRED');
 const ml=(await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Gốm Sứ Minh Long Cần Thơ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'})).data.id;
 assert.ok(ml);await f.db.update(web).set({registerId:ml,source:'minhlong'}).where(eq(web.id,f.webId));
 assert.equal((await f.call('/orders/'+encodeURIComponent(f.id),f.emp)).status,404);
 assert.equal((await f.call('/orders?source=web',f.emp)).data.total,0);
 const denied=await f.call('/orders/'+encodeURIComponent(f.id)+'/web-edit',f.emp,'PUT',{...f.cart,clientKey:crypto.randomUUID()});assert.equal(denied.status,404);
});
test('PostgreSQL: concurrent cart save and duplicate confirmation cannot change shipped goods or create a second GHN order',{skip:!process.env.TEST_PG_URL},async()=>{
 const f=await fixture();assert.equal((await f.edit(await f.detail())).status,200);const d=await f.detail();
 let ready!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{ready=r;}),unblock=new Promise<void>(r=>{release=r;});let creates=0;
 f.env.ghnToken='local-test-only';f.env.ghnFetch=async url=>{if(String(url).endsWith('/create')){creates++;ready();await unblock;return Response.json({code:200,data:{order_code:'CONCURRENT21569'}});}return Response.json({code:404},{status:404});};
 const confirm=()=>f.call('/pos/web-orders/'+f.webId+'/action',f.mgr,'POST',{action:'confirm',...address,webRevision:1,codAmount:108000,ghnWeight:1000,ghnRequiredNote:'KHONGCHOXEMHANG'});
 const a=confirm();await entered;
 const b=confirm(),saving=f.call('/orders/'+encodeURIComponent(f.id)+'/web-edit',f.mgr,'PUT',{...f.cart,lines:[{...f.cart.lines[0],qty:2}],clientKey:crypto.randomUUID(),revision:d.revision,sourceHash:d.sourceHash,expectedTotal:216000,pricingReviewed:true,paymentReviewed:true,reason:'Race check'});
 release();const [ra,rb,re]=await Promise.all([a,b,saving]);assert.equal(ra.status,200);assert.equal(rb.status,200);assert.equal(re.status,409);assert.equal(creates,1);assert.equal((await f.detail()).items[0].quantity,1);
});
