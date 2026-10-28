import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

/**
 * Sổ kho đơn web theo trạng thái GHN (web-order-stock.ts): GHN báo đã lấy hàng → tự trừ kho quầy; đã hoàn về shop → tự cộng lại.
 * Không trừ được → đánh dấu cần đối soát, báo Manager, lượt đồng bộ sau tự làm lại. Gửi lặp / đồng thời không trừ hai lần.
 * Kho quầy (Kho POS) có 10 cái mã 00123.
 */
async function fixture(){
 const f=await setup();
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 f.env.ghnWebhookToken='w'.repeat(40);
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;
 let n=0;
 /** Website Lock báo đơn kèm trạng thái GHN qua cầu nối (meta _lnl_ghn_*). */
 const lock=async(ghnStatus:string,id=1000,lines=[{sku:'00123',name:'Ly sứ',quantity:2,total:'200000'}])=>{
  const r=await f.call('/integrations/woocommerce/lock/order?token=test-lock-token','','POST',{id,number:'L'+id,status:'processing',total:'200000',billing:{first_name:'Khách web',phone:'0901'},
   line_items:lines,meta_data:[{key:'_lnl_ghn_order_code',value:'GLK'+id},{key:'_lnl_ghn_last_status',value:ghnStatus}],date_modified_gmt:new Date(Date.now()+(n++)*1000).toISOString()});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return (await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.externalId,String(id))))[0]!;
 };
 /** GHN gọi webhook trạng thái vận đơn. */
 const hook=(code:string,status:string)=>f.call('/integrations/ghn/pos-lock/webhook?token='+'w'.repeat(40),'','POST',{OrderCode:code,Status:status});
 const moves=async(id:string)=>(await f.db.select().from(stockMoves).where(and(eq(stockMoves.refType,'web_order'),eq(stockMoves.refId,id)))).map(m=>[m.kind,m.qty]);
 return {...f,balance,lock,hook,moves};
}

test('chờ lấy hàng không trừ; GHN đã lấy hàng → trừ kho quầy một lần; đang giao / đã giao không trừ thêm; nhãn sổ kho rõ ràng',async()=>{
 const f=await fixture();
 const o=await f.lock('ready_to_pick');assert.equal(await f.balance(),10);assert.equal(o.stockStatus,'none');
 ok200(await f.hook('GLK1000','picked'));assert.equal(await f.balance(),8);
 for(const s of ['delivering','delivering','delivered'])ok200(await f.hook('GLK1000',s));
 assert.equal(await f.balance(),8);assert.deepEqual(await f.moves(o.id),[['issue',-2]]);
 const [row]=await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,o.id));assert.equal(row!.stockStatus,'issued');
 const [m]=await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'web_order'));assert.match(m!.note,/^Tự động theo GHN/);
});

test('GHN hoàn hàng: đang hoàn chưa cộng; đã hoàn về shop → cộng lại đúng số đã trừ một lần',async()=>{
 const f=await fixture();
 const o=await f.lock('picked');assert.equal(await f.balance(),8);
 ok200(await f.hook('GLK1000','returning'));assert.equal(await f.balance(),8);
 ok200(await f.hook('GLK1000','returned'));ok200(await f.hook('GLK1000','returned'));
 assert.equal(await f.balance(),10);assert.deepEqual(await f.moves(o.id),[['issue',-2],['reverse',2]]);
 assert.equal((await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,o.id)))[0]!.stockStatus,'returned');
});

test('huỷ trước khi lấy hàng: không trừ; hoàn về khi chưa từng trừ: không cộng',async()=>{
 const f=await fixture();
 const o=await f.lock('ready_to_pick');ok200(await f.hook('GLK1000','cancel'));
 assert.equal(await f.balance(),10);assert.deepEqual(await f.moves(o.id),[]);
});

test('mã website không có trong danh mục / thiếu tồn: không chặn GHN, đánh dấu cần đối soát, báo Manager một lần; đồng bộ sau tự trừ khi đã sửa',async()=>{
 const f=await fixture();
 const o=await f.lock('picked',1001,[{sku:'WEB-ONLY',name:'Mã lạ',quantity:1,total:'1'}]);
 assert.equal(o.stockStatus,'blocked');assert.match(o.stockNote,/WEB-ONLY/);assert.equal(o.ghnStatus,'picked','trạng thái GHN vẫn lưu');
 ok200(await f.hook('GLK1001','delivering'));
 const notes=(await f.call('/notifications',f.mgr)).data.notifications.filter((x:any)=>x.title==='Đơn web chưa trừ được kho');assert.equal(notes.length,1,'báo một lần');
 // Thiếu tồn: 12 > 10.
 const short=await f.lock('picked',1002,[{sku:'00123',name:'Ly sứ',quantity:12,total:'1'}]);
 assert.equal(short.stockStatus,'blocked');assert.match(short.stockNote,/Tồn kho không đủ/);assert.equal(await f.balance(),10);
 // Sửa: thêm mã vào danh mục + nhập thêm hàng → lượt đồng bộ GHN (lưới an toàn) tự trừ.
 await f.db.insert(products).values({sku:'WEB-ONLY',name:'Mã lạ',unit:'cái',updatedAt:new Date().toISOString()});
 await postMoves(f.db,'mgr',[{sku:'WEB-ONLY',warehouseId:'pos-wh',qty:3,kind:'adjust',refType:'adjustment',refId:'web-only-in'},{sku:'00123',warehouseId:'pos-wh',qty:5,kind:'adjust',refType:'adjustment',refId:'more-cups'}]);
 const {reconcileWebOrderStock}=await import('../../src/modules/sales/api/web-order-stock.ts');
 assert.equal(await reconcileWebOrderStock(f.env),2);
 assert.equal(await f.balance(),3);
 assert.deepEqual((await f.db.select().from(webStoreOrders)).map(w=>w.stockStatus).sort(),['issued','issued']);
 assert.equal(await reconcileWebOrderStock(f.env),0,'chạy lại không ghi thêm');
});

test('webhook gửi đồng thời: trừ kho đúng một lần',async()=>{
 const f=await fixture();
 await f.lock('ready_to_pick');
 const rs=await Promise.all([1,2,3,4].map(()=>f.hook('GLK1000','picked')));
 assert.ok(rs.every(r=>r.status===200),JSON.stringify(rs.map(r=>r.data)));
 assert.equal(await f.balance(),8);
});

test('đơn đã lấy hàng trước khi bật (legacy) không tự trừ bù',async()=>{
 const f=await fixture();
 const o=await f.lock('ready_to_pick');
 await f.db.update(webStoreOrders).set({stockStatus:'legacy'}).where(eq(webStoreOrders.id,o.id));
 ok200(await f.hook('GLK1000','delivered'));ok200(await f.hook('GLK1000','returned'));
 assert.equal(await f.balance(),10);assert.deepEqual(await f.moves(o.id),[]);
});

function ok200(r:{status:number;data:unknown}){assert.equal(r.status,200,JSON.stringify(r.data));}
