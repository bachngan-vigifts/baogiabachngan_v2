import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {incomingShipmentLines,suppliers} from '../../src/modules/suppliers/schema.ts';
import {purchaseReadLevel} from '../../src/modules/suppliers/domain/purchase-access.ts';
import {canPay,canReceive,canSeePrices,canApprovePurchase} from '../../src/modules/suppliers/domain/purchasing.ts';
import {purchaseCatalogVariant} from '../../src/modules/suppliers/api/purchase-projection.ts';

test('NVBH ML và LOCK: xem/lập nháp bốn hãng; chặn mã lạ, đơn trộn, sửa vượt phạm vi và thu hồi hãng',async()=>{
 const f=await setupEarly(),now=new Date().toISOString();
 await f.db.insert(products).values([
  {sku:'031106000',name:'Chén',brand:'Minh Long'},
  {sku:'LYS',name:'Ly',brand:'Minh Long - LYS'},
  {sku:'HC',name:'Nồi',brand:'Healthy Cook'},
  {sku:'LOCK',name:'Bình',brand:'Lock&Lock'},
  {sku:'OTHER',name:'Minh Long giả trong tên',brand:'Khác'},
  {sku:'EMPTY',name:'Lock&Lock',brand:''},
 ].map(p=>({...p,updatedAt:now})));
 const order=(sku:string)=>({supplierId:'a',warehouse:'Kho nhận',lines:[{sku,quantity:1}]});
 for(const positionId of ['sales-ml','sales-lock']){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  const cookie=f.cookies.emp;
  const opts=await f.call('/purchase-options',cookie);assert.equal(opts.status,200,JSON.stringify(opts.data));
  for(const key of ['canSeePrices','canPay','canReceive','canEditSuppliers','canRequestEarly'])assert.equal(opts.data[key],false,key);
  const lookup=await f.call('/purchase-products?skus=031106000,LYS,HC,LOCK,OTHER,EMPTY,UNKNOWN',cookie);
  assert.equal(lookup.status,200);assert.deepEqual(lookup.data.products.map((p:any)=>p.sku),['031106000','LYS','HC','LOCK']);assert.deepEqual(lookup.data.missing,['OTHER','EMPTY','UNKNOWN']);
  assert.equal((await f.call('/purchase-orders/a1',cookie)).status,200);
  assert.equal((await f.call('/purchase-orders/excel',cookie)).status,404,'unknown catalog brand hidden');
  for(const sku of ['OTHER','EMPTY','UNKNOWN'])assert.equal((await f.call('/purchase-orders',cookie,'POST',{orders:[order(sku)]})).status,403,sku);
  const body={clientKey:crypto.randomUUID(),orders:[{...order('LOCK'),lines:['031106000','LYS','HC','LOCK'].map(sku=>({sku,quantity:1}))}]};
  const created=await f.call('/purchase-orders',cookie,'POST',body);assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.ids[0];
  const detail=await f.call('/purchase-orders/'+id,cookie);assert.equal(detail.status,200);assert.equal(detail.data.submittedAt,null);
  assert.equal((await f.call('/purchase-orders/'+id,cookie,'PUT',{...order('OTHER'),revision:detail.data.revision})).status,403);
  assert.equal((await f.call('/purchase-orders',cookie,'POST',body)).status,200,'idempotent replay');
  assert.equal((await f.call('/purchase-orders/'+id+'/submit',cookie,'POST',{revision:detail.data.revision})).status,200);
 }
 const early=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-11-25',lines:[{sku:'031106000',quantity:1}]});assert.equal(early.status,201,JSON.stringify(early.data));
 assert.equal((await f.call('/purchase-early-requests?id='+early.data.id,f.cookies.emp)).status,200);
 await f.db.insert(incomingShipmentLines).values({id:'mixed',shipmentId:'a1',lineNo:2,sku:'OTHER',name:'Ngoài phạm vi',quantity:1});
 assert.equal((await f.call('/purchase-orders/a1',f.cookies.emp)).status,404);
 assert.equal((await f.call('/purchase-early-requests?id='+early.data.id,f.cookies.emp)).status,404,'early request cannot expose mixed parent');
 const list=await f.call('/purchase-orders',f.cookies.emp);assert.equal(list.status,200);assert.ok(!list.data.orders.some((o:any)=>o.id==='a1'||o.id==='excel'));
 assert.equal((await f.call('/purchase-orders/a1',f.cookies.sa)).status,200,'Sale Admin unchanged');
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'a'));
 assert.equal((await f.call('/purchase-orders/b1',f.cookies.emp)).status,200);
 assert.equal((await f.call('/purchase-orders',f.cookies.emp,'POST',{orders:[order('LOCK')]})).status,201,'NVBH product scope independent of Sale Admin supplier mapping');
 await f.db.update(products).set({brand:'Khác'}).where(eq(products.sku,'LOCK'));
 assert.equal((await f.call('/purchase-orders',f.cookies.emp,'POST',{orders:[order('LOCK')]})).status,403,'product brand revoked');
 const viewer={id:'emp',role:'employee',positionId:'sales-lock',active:true,perms:['page.purchases']};
 assert.notEqual(await purchaseCatalogVariant(f.db,viewer),await purchaseCatalogVariant(f.db,{...viewer,positionId:'sale-admin'}));
});

test('Quyền NVBH không mở duyệt, giá, thanh toán, nhận kho; vẫn tôn trọng thu hồi page.purchases',()=>{
 for(const positionId of ['sales-ml','sales-lock']){
  const a={id:'x',role:'employee' as const,positionId,active:true};
  assert.equal(purchaseReadLevel(a),'brand');
  for(const check of [canPay,canReceive,canSeePrices,canApprovePurchase]){assert.equal(check(a),false);assert.equal(check({...a,perms:['purchases.receive','purchases.pay','purchases.prices'],approver:true}),false);}
  assert.equal(purchaseReadLevel({...a,perms:[]}),'none');assert.equal(purchaseReadLevel({...a,active:false}),'none');
 }
});
