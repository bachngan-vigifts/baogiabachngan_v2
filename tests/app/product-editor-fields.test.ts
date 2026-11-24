import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';

test('Form sản phẩm lưu mã vạch giữ số0, danh mục/bộ sưu tập/hoa văn độc lập và tra được qua POS',async()=>{
 const f=await setup(),body={sku:'EDITOR-NEW',name:'Ly thử',barcode:'0008930000001',category:'Ly',collection:'Quà tặng 2026',pattern:'Hoa sen',unit:'Cái',prices:{retail:100000,'retail-vat':108000}};
 const saved=await f.call('/products',f.mgr,'POST',body);assert.equal(saved.status,201,JSON.stringify(saved.data));
 const detail=(await f.call('/products/EDITOR-NEW',f.mgr)).data.product;
 assert.deepEqual([detail.category,detail.collection,detail.pattern],['Ly','Quà tặng 2026','Hoa sen']);assert.deepEqual(detail.barcodes,['0008930000001']);
 const catalog=await f.call('/pos/catalog?registerId='+f.registerId+'&q=0008930000001',f.emp);assert.equal(catalog.status,200);assert.equal(catalog.data.products[0].sku,'EDITOR-NEW');
});

import {eq,sql} from 'drizzle-orm';
import {products,productBarcodes,productPrices} from '../../src/modules/catalog/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {readFileSync} from 'node:fs';
const fresh=(sku:string,barcode?:string)=>({sku,name:'Ly '+sku,category:'Đồ uống',collection:'Sen',pattern:'Hoa sen',...(barcode===undefined?{}:{barcode}),prices:{retail:100000,'retail-vat':108000}});

test('Sửa giữ mã cũ, có audit, chống ghi đè; client cũ không xoá danh mục/bộ sưu tập',async()=>{
 const f=await setup();await f.db.insert(productBarcodes).values({sku:'00123',barcode:'OLD-CODE'});
 let p=(await f.call('/products/00123',f.mgr)).data.product;
 const beforeStock=await f.db.select().from(stockBalances),beforePrices=await f.db.select().from(productPrices);
 const body={...fresh('00123','0000123456'),name:p.name,expectedUpdatedAt:p.updatedAt,prices:{}};
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',body)).status,200);
 const stale=await f.call('/products/00123',f.mgr,'PUT',{...body,name:'Không được ghi đè'});assert.equal(stale.status,409);assert.equal(stale.data.code,'PRODUCT_CHANGED');
 p=(await f.call('/products/00123',f.mgr)).data.product;assert.deepEqual(p.barcodes,['0000123456','OLD-CODE']);assert.equal(p.name,body.name);
 const oldClient={sku:'00123',name:p.name,brand:p.brand,unit:p.unit,pattern:p.pattern,imageUrl:p.imageUrl,prices:{},expectedUpdatedAt:p.updatedAt};
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',oldClient)).status,200);
 p=(await f.call('/products/00123',f.mgr)).data.product;assert.deepEqual([p.category,p.collection,p.pattern],['Đồ uống','Sen','Hoa sen']);
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...oldClient,expectedUpdatedAt:p.updatedAt,category:'',collection:'',barcode:''})).status,200);
 p=(await f.call('/products/00123',f.mgr)).data.product;assert.deepEqual([p.category,p.collection],['','']);assert.deepEqual(p.barcodes,['0000123456','OLD-CODE']);
 assert.deepEqual(await f.db.select().from(stockBalances),beforeStock);assert.deepEqual(await f.db.select().from(productPrices),beforePrices);
 const audit=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'barcode-add'));assert.equal(audit.length,1);assert.deepEqual(JSON.parse(audit[0]!.data),{barcode:'0000123456',sku:'00123'});
});

test('Mã vạch trùng SKU/mã khác hoặc dữ liệu sai bị chặn, không lưu dở sản phẩm/giá',async()=>{
 const f=await setup();await f.db.insert(productBarcodes).values({sku:'00123',barcode:'TAKEN'});
 for(const [sku,code] of [['NEW-A','00123'],['NEW-B','TAKEN'],['TAKEN','FREE-CODE']]){
  const r=await f.call('/products',f.mgr,'POST',fresh(sku!,code));assert.equal(r.status,409,JSON.stringify(r.data));assert.equal((await f.db.select().from(products).where(eq(products.sku,sku!))).length,0);assert.equal((await f.db.select().from(productPrices).where(eq(productPrices.sku,sku!))).length,0);
 }
 for(const extra of [{barcode:'two words'},{barcode:'é'},{barcode:'x'.repeat(101)},{barcode:123},{category:'x'.repeat(201)},{collection:null}])assert.equal((await f.call('/products',f.mgr,'POST',{...fresh('BAD'),...extra})).status,400,JSON.stringify(extra));
 const original=(await f.call('/products/00123',f.mgr)).data.product;
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...fresh('00123','TAKEN'),name:'Đã sửa',expectedUpdatedAt:original.updatedAt})).status,200,'mã đang gắn chính SKU đó được giữ');
 await f.db.insert(products).values({sku:'OTHER',name:'Khác',updatedAt:new Date().toISOString()});await f.db.insert(productBarcodes).values({sku:'OTHER',barcode:'OTHER-CODE'});
 const p=(await f.call('/products/00123',f.mgr)).data.product;
 const conflict=await f.call('/products/00123',f.mgr,'PUT',{...fresh('00123','OTHER-CODE'),name:'Không được lưu dở',category:'Sai',expectedUpdatedAt:p.updatedAt});assert.equal(conflict.status,409);
 assert.deepEqual((await f.call('/products/00123',f.mgr)).data.product,p);
});

test('Không nới quyền mã vạch; nhân viên vẫn tạo sản phẩm chờ duyệt với ba trường phân loại',async()=>{
 const f=await setup();assert.equal((await f.call('/products',f.emp,'POST',fresh('EMP-CODE','000111'))).status,403);
 assert.equal((await f.db.select().from(products).where(eq(products.sku,'EMP-CODE'))).length,0);
 const p=(await f.call('/products/00123',f.emp)).data.product;
 assert.equal((await f.call('/products/00123',f.emp,'PUT',{...fresh('00123','000111'),expectedUpdatedAt:p.updatedAt})).status,403);
 const created=await f.call('/products',f.emp,'POST',fresh('EMP-CLASS'));assert.equal(created.status,201);assert.equal(created.data.approvalStatus,'pending');
 const pending=(await f.call('/product-approvals',f.emp)).data.products.find((p:any)=>p.sku==='EMP-CLASS');assert.deepEqual([pending.category,pending.collection,pending.pattern],['Đồ uống','Sen','Hoa sen']);assert.equal(pending.active,false);
 assert.equal((await f.call('/products/EMP-CLASS/approve',f.mgr,'POST',{})).status,200);
 assert.equal((await f.call('/products/EMP-CLASS',f.emp)).data.product.category,'Đồ uống');
});

test('Audit lỗi rollback nguyên transaction; hai sản phẩm tranh cùng mã chỉ một sản phẩm được tạo',async()=>{
 const f=await setup(),stock=await f.db.select().from(stockMoves);
 await f.db.execute(sql`create function reject_editor_barcode() returns trigger language plpgsql as $$ begin if NEW.action='barcode-add' then raise exception 'test barcode audit failure'; end if; return NEW; end $$`);
 await f.db.execute(sql`create trigger reject_editor_barcode before insert on audit_logs for each row execute function reject_editor_barcode()`);
 const failed=await f.call('/products',f.mgr,'POST',fresh('AUDIT-ROLLBACK','000999'));assert.equal(failed.status,500);
 assert.equal((await f.db.select().from(products).where(eq(products.sku,'AUDIT-ROLLBACK'))).length,0);assert.equal((await f.db.select().from(productBarcodes).where(eq(productBarcodes.barcode,'000999'))).length,0);
 await f.db.execute(sql`drop trigger reject_editor_barcode on audit_logs`);
 const results=await Promise.all(['RACE-A','RACE-B'].map(sku=>f.call('/products',f.mgr,'POST',fresh(sku,'000999'))));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const mapping=await f.db.select().from(productBarcodes).where(eq(productBarcodes.barcode,'000999'));assert.equal(mapping.length,1);
 const list=(await f.call('/products?q=000999',f.emp)).data.products;assert.equal(list.length,1);assert.equal(list[0].sku,mapping[0]!.sku);assert.deepEqual(await f.db.select().from(stockMoves),stock);
});

test('Migration phân loại nullable/add-only và assert READ ONLY; không đổi hoa văn hoặc RLS',async()=>{
 const f=await setup(),gate=readFileSync('scripts/sql/assert-product-classification-fields.sql','utf8'),migration=readFileSync('migrations/postgres/20261124025900_product_classification_fields.sql','utf8');
 await f.db.update(products).set({pattern:'Hoa văn cũ'}).where(eq(products.sku,'00123'));
 await f.client.exec('BEGIN READ ONLY;'+gate+'ROLLBACK;');await f.client.exec(migration);
 const [p]=await f.db.select().from(products).where(eq(products.sku,'00123'));assert.equal(p!.category,null);assert.equal(p!.collection,null);assert.equal(p!.pattern,'Hoa văn cũ');
 const security=await f.client.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='products'::regclass");assert.equal(security.rows[0]!.relrowsecurity,true);
 await f.client.exec('ALTER TABLE products DROP COLUMN collection');await assert.rejects(f.client.exec(gate),/missing nullable products/);
});
