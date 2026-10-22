import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customers } from '../../src/modules/customers/schema.ts';

test('POS saves complete customer fields and terms, rejects invalid input and duplicate tax codes', async () => {
  const { db, call, emp, ncc } = await setup();
  const body = { name: 'Công ty mới', contact: 'Chị Hoa', phone: '0909876543', email: 'hoa@example.vn',
    taxCode: '0123456789', customerCode: 'KH-MOI', address: '12 Nguyễn Trãi',
    depositRate: '25', paymentTerm: '15 ngày', creditLimit: '50.000.000' };
  const response = await call('/pos/customers', emp, 'POST', body);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  const [saved] = await db.select().from(customers).where(eq(customers.id, response.data.id));
  for (const field of ['name', 'contact', 'phone', 'email', 'taxCode', 'customerCode', 'address', 'paymentTerm'] as const)
    assert.equal(saved![field], body[field]);
  assert.equal(saved!.depositRate, 25); assert.equal(saved!.creditLimit, 50000000);
  assert.equal(saved!.approvalStatus, 'approved');
  assert.equal((await call('/pos/customers', emp, 'POST', body)).status, 409);
  for (const invalid of [{ email: 'bad' }, { depositRate: '101' }, { paymentTerm: '3651 ngày' }, { phone: '' }]) {
    assert.equal((await call('/pos/customers', emp, 'POST', { ...body, ...invalid, taxCode: '' })).status, 400);
  }
  assert.equal((await call('/pos/customers', ncc, 'POST', { ...body, taxCode: '' })).status, 403);
});

test('customer identity: prevent name/phone/tax duplicates across CRM, POS, edits, imports and simultaneous saves', async () => {
  const {db,call,emp,mgr,ncc}=await setup();
  const a={name:'FPT - Nhật Phương',phone:'0868 908 378',taxCode:'0101234567',address:'Hà Nội'};
  const saved=await call('/customers',mgr,'POST',a);assert.equal(saved.status,201,JSON.stringify(saved.data));
  const id=saved.data.id;
  for(const duplicate of [{name:'Khác một',phone:'+84 868 908 378',taxCode:''},{name:'FPT NHAT PHUONG',phone:'',taxCode:''},{name:'Khác hai',phone:'',taxCode:'0101 234.567'}]) {
    for(const path of ['/customers','/pos/customers']) {
      const input=path.startsWith('/pos')?{...duplicate,phone:duplicate.phone||'0977000001'}:duplicate;
      const r=await call(path,mgr,'POST',input);assert.equal(r.status,409,JSON.stringify(r.data));
    }
  }
  const check=await call('/customers/duplicates/check?name=FPT%20NHAT%20PHUONG&phone=%2B84868908378',mgr);
  assert.equal((await call('/customers/duplicates/check?name='+encodeURIComponent('FPT Nhật Phương'.normalize('NFD')),mgr)).data.matches[0].id,id,'decomposed Vietnamese text matches');
  assert.equal(check.status,200);assert.equal(check.data.matches[0].id,id);assert.deepEqual(check.data.matches[0].reasons.sort(),['name','phone']);
  assert.deepEqual(Object.keys(check.data.matches[0]).sort(),['id','name','reasons']);
  assert.equal((await call('/customers/duplicates/check?exceptId='+id+'&name=FPT%20NHAT%20PHUONG',mgr)).data.matches.length,0);
  assert.equal((await call('/customers/'+id,mgr,'PUT',{...a,name:'FPT NHẬT PHƯƠNG',phone:'0084868908378',address:'Địa chỉ mới'})).status,200,'format-only edits remain valid');
  const b=await call('/customers',mgr,'POST',{name:'Hồ sơ khác',phone:'0977111111'});assert.equal(b.status,201);
  assert.equal((await call('/customers/'+b.data.id,mgr,'PUT',{name:'FPT NHAT PHUONG'})).status,409);
  const [old]=await db.select().from(customers).where(eq(customers.id,id));
  await db.insert(customers).values({...old!,id:'legacy-copy'});
  assert.equal((await call('/customers/'+id,mgr,'PUT',{...a,address:'Cập nhật địa chỉ'})).status,200,'legacy duplicates can edit unrelated fields');
  const parallel=await Promise.all([call('/customers',mgr,'POST',{name:'Song song CRM',phone:'0977222222'}),call('/pos/customers',emp,'POST',{name:'Song song POS',phone:'+84977222222'})]);
  assert.deepEqual(parallel.map(r=>r.status).sort(),[201,409]);
  const {syncCustomers}=await import('../../src/modules/integrations/api/sapo-sync-routes.ts');
  const synced=await syncCustomers(db,{customers:[{id:'9000999',name:'FPT tên nhập khác',phone:'0868908378',tax_code:'9999999999',updated_at:'2026-10-22T00:00:00Z'}]});
  assert.equal(synced.duplicates,1);assert.equal((await db.select().from(customers).where(eq(customers.id,'9000999'))).length,0);
  assert.equal((await call('/pos/customers?id='+b.data.id,mgr)).data.customers[0].id,b.data.id);
  assert.equal((await call('/customers/duplicates/check?name=FPT',ncc)).status,403);
  assert.equal((await call('/pos/customers/duplicates/check?name=FPT',ncc)).status,403);
  assert.equal((await call('/customers/duplicates/check?name=FPT','')).status,401);
  await db.insert(customers).values({id:'private-retail',name:'Tên khách lẻ hạn chế',phone:'0977333333',contact:'',email:'',address:'',isRetail:true,search:'',sourceVersion:0,syncedAt:''});
  const {employees}=await import('../../src/modules/staff/schema.ts');
  await db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
  const hidden=(await call('/customers/duplicates/check?phone=0977333333',emp)).data.matches[0];
  assert.equal(hidden.id,null);assert.equal(hidden.name,'Khách hàng trong danh mục hạn chế');
  const blocked=await call('/customers',emp,'POST',{name:'Tên mới riêng',phone:'0977333333'});
  assert.equal(blocked.status,409);assert.equal(blocked.data.error.includes('Tên khách lẻ hạn chế'),false);
});
