import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerContacts, customerNotes, customerStaff } from '../../src/modules/customers/schema.ts';
import { appsheetCustomerLinks, appsheetContactLinks, appsheetSyncRuns } from '../../src/modules/customers/appsheet-schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { parseAppsheetInput } from '../../src/modules/customers/domain/appsheet-input.ts';
import { mergeCustomers } from '../../src/modules/customer-hub/api/duplicates.ts';
import { syncCustomers } from '../../src/modules/integrations/api/sapo-sync-routes.ts';

const stamp = '2026-10-01T00:00:00.000Z', later = '2026-10-02T00:00:00.000Z';
const input = () => ({ format: 'appsheet-customers-v1', appId: 'fake-vigifts', customersTable: 'KH', contactsTable: 'LH',
  customers: [{ rowId: 'KH-1', updatedAt: stamp, createdAt: '2020-01-01T00:00:00+07:00',
    fields: { name: 'Công ty Kiểm thử', approvalStatus: 'Đã duyệt', phone: '0901234567', taxCode: '1234567890', customerCode: 'KH0001', customerType: 'Đối tác', establishedDate: '2010-02-03', contact: 'Liên hệ gốc' } }],
  contacts: [{ rowId: 'LH-1', customerRowId: 'KH-1', updatedAt: stamp, fields: { name: 'Người thử A', phone: '0912345678', title: 'Kế toán', note: 'Ghi chú nguồn', isPrimary: true } }],
  resolutions: { customers: {} as Record<string,string>, contacts: {} as Record<string,string> } });

async function setup() {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie: string, method = 'POST', body?: unknown) => {
    const r = await router.handle(new Request(origin+'/api/staff'+path, { method, headers:{origin,cookie,'content-type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body) }), { db, passwordIterations:1000, sapoOrderPush:'off' });
    return { status:r.status, data:await r.json() as any, cookie:r.headers.get('set-cookie')?.split(';')[0]||'' };
  };
  const mgr = (await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
  const emp = (await call('/login','','POST',{email:'emp@x.vn',password:PASSWORD})).cookie;
  const preview = (value: unknown) => call('/appsheet-customers/preview',mgr,'POST',{input:value});
  const apply = async (value: unknown) => {const p=await preview(value); assert.equal(p.status,200,JSON.stringify(p.data));return call('/appsheet-customers/apply',mgr,'POST',{input:value,planHash:p.data.planHash});};
  return { db, client, call, mgr, emp, preview, apply };
}
test('AppSheet contract rejects blank/duplicate keys, invalid dates, unknown fields/status and oversize batches', () => {
  const valid=parseAppsheetInput(input());assert.equal(valid.customers[0]!.createdAt,'2019-12-31T17:00:00.000Z');
  for (const change of [
    (v:any)=>v.customers[0].rowId='',(v:any)=>v.customers.push(v.customers[0]),
    (v:any)=>v.customers[0].fields.approvalStatus='Tự đoán', (v:any)=>v.customers[0].updatedAt='01/10/2026',
    (v:any)=>v.customers[0].fields.establishedDate='2026-02-30', (v:any)=>v.customers[0].fields.ownerId='mgr',
    (v:any)=>v.customers=Array.from({length:201},(_,i)=>({...v.customers[0],rowId:String(i)})),
  ]) {const v=input();change(v);assert.throws(()=>parseAppsheetInput(v));}
});

test('AppSheet API: manager-only, preview is read-only, replay idempotent, source IDs/date/contacts retained, counts-only logs', async () => {
  const s=await setup(),v=input();
  for (const [cookie,status] of [['',401],[s.emp,403]] as const) {
    for (const route of ['preview','apply'])assert.equal((await s.call('/appsheet-customers/'+route,cookie,'POST',{input:v})).status,status);
    assert.equal((await s.call('/appsheet-customers/runs',cookie,'GET')).status,status);
  }
  const p=await s.preview(v);assert.equal(p.status,200);assert.equal(p.data.summary.create,2);
  assert.equal((await s.db.select().from(customers)).length,0);assert.equal((await s.db.select().from(appsheetSyncRuns)).length,0);
  assert.equal((await s.call('/appsheet-customers/apply',s.mgr,'POST',{input:v})).status,400);
  const first=await s.call('/appsheet-customers/apply',s.mgr,'POST',{input:v,planHash:p.data.planHash});assert.equal(first.status,200,JSON.stringify(first.data));
  const [c]=await s.db.select().from(customers);assert.ok(c);assert.equal(c.customerType,'Đối tác');assert.equal(c.establishedDate,'2010-02-03');assert.equal(c.isRetail,false);
  assert.equal(c.dataSource,'appsheet');assert.notEqual(c.createdAt,'2019-12-31T17:00:00.000Z');assert.equal(c.approvalStatus,'approved');
  const [link]=await s.db.select().from(appsheetCustomerLinks);assert.equal(link!.sourceCreatedAt,'2019-12-31T17:00:00.000Z');
  const [contact]=await s.db.select().from(customerContacts);assert.equal(contact!.customerId,c.id);assert.equal(contact!.isPrimary,true);
  const again=await s.apply(v);assert.equal(again.status,200);assert.equal(again.data.summary.unchanged,2);
  assert.equal((await s.db.select().from(customers)).length,1);assert.equal((await s.db.select().from(customerContacts)).length,1);
  assert.equal((await s.call('/appsheet-customers/apply',s.mgr,'POST',{input:v,planHash:p.data.planHash})).status,409,'lost-response replay cannot duplicate');
  const runs=await s.call('/appsheet-customers/runs',s.mgr,'GET');assert.equal(runs.data.runs.length,2);
  const logs=JSON.stringify(await s.db.select().from(auditLogs));assert.ok(!logs.includes('Người thử A')&&!logs.includes('0901234567'));
  const runLogs=JSON.stringify(await s.db.select().from(appsheetSyncRuns));assert.ok(!runLogs.includes('Người thử A')&&!runLogs.includes('0901234567'));
});

test('AppSheet updates preserve local changes, do not accept stale/same-version conflicting payloads, and invalidate old previews', async () => {
  const s=await setup(),v=input();assert.equal((await s.apply(v)).status,200);
  const [c]=await s.db.select().from(customers),[contact]=await s.db.select().from(customerContacts);
  const p=await s.preview(v);
  await s.db.update(customers).set({address:'Địa chỉ nhân viên sửa',depositRate:40,paymentTerm:'30 ngày',creditLimit:50000}).where(eq(customers.id,c!.id));
  await s.db.update(customerContacts).set({title:'Chức vụ nhân viên sửa'}).where(eq(customerContacts.id,contact!.id));
  assert.equal((await s.call('/appsheet-customers/apply',s.mgr,'POST',{input:v,planHash:p.data.planHash})).status,409);
  const changed:any=structuredClone(v);changed.customers[0].updatedAt=later;changed.customers[0].fields.name='Tên nguồn cập nhật';changed.customers[0].fields.address='Địa chỉ nguồn';
  changed.contacts[0].updatedAt=later;changed.contacts[0].fields.title='Chức vụ nguồn';changed.contacts[0].fields.note='Ghi chú cập nhật';
  const result=await s.apply(changed);assert.equal(result.status,200);assert.ok(result.data.reports[0].preserved.includes('address'));
  const [updated]=await s.db.select().from(customers);assert.equal(updated!.name,'Tên nguồn cập nhật');assert.equal(updated!.address,'Địa chỉ nhân viên sửa');assert.equal(updated!.depositRate,40);assert.equal(updated!.paymentTerm,'30 ngày');assert.equal(updated!.creditLimit,50000);
  const [updatedContact]=await s.db.select().from(customerContacts);assert.equal(updatedContact!.title,'Chức vụ nhân viên sửa');assert.equal(updatedContact!.note,'Ghi chú cập nhật');
  const stale=await s.apply(v);assert.equal(stale.data.reports[0].action,'stale');
  changed.customers[0].fields.name='Khác cùng phiên bản';const conflict=await s.apply(changed);assert.equal(conflict.data.reports[0].action,'conflict');
  assert.equal((await s.db.select().from(customers))[0]!.name,'Tên nguồn cập nhật');
});

test('AppSheet matching requires explicit resolution, preserves Sapo/local ownership and existing staff/notes/primary contacts', async () => {
  const s=await setup(),v=input();
  await syncCustomers(s.db,{customers:[{id:'90001',name:'Khách Sapo',tax_code:'1234567890',phone:'0901234567',updated_at:stamp}]});
  const [existing]=await s.db.select().from(customers);assert.ok(existing);
  await s.db.insert(customerNotes).values({customerId:existing.id,text:'Ghi chú nội bộ',updatedBy:'mgr',updatedAt:stamp});
  await s.db.insert(customerStaff).values({customerId:existing.id,memberId:'emp',role:'owner',createdAt:stamp});
  await s.db.insert(customerContacts).values({id:'manual',customerId:existing.id,name:'Liên hệ thủ công',isPrimary:true,createdAt:stamp,updatedAt:stamp});
  const preview=await s.preview(v);assert.equal(preview.data.reports[0].action,'conflict');assert.equal(preview.data.reports[0].candidates[0].id,existing.id);
  v.resolutions.customers['KH-1']=existing.id;const applied=await s.apply(v);assert.equal(applied.status,200);assert.equal(applied.data.reports[0].action,'link');
  assert.ok(applied.data.reports[0].preserved.includes('name'));assert.ok(applied.data.reports[1].preserved.includes('isPrimary'));
  assert.equal((await s.db.select().from(customers)).length,1);assert.equal((await s.db.select().from(customers))[0]!.name,'Khách Sapo');
  assert.equal((await s.db.select().from(customerNotes))[0]!.text,'Ghi chú nội bộ');assert.equal((await s.db.select().from(customerStaff))[0]!.memberId,'emp');
  assert.equal((await s.db.select().from(customerContacts)).filter(c=>c.isPrimary).length,1);
  const changed=structuredClone(v);changed.customers[0]!.updatedAt=later;changed.customers[0]!.fields.name='AppSheet muốn đổi';assert.equal((await s.apply(changed)).status,200);
  assert.equal((await s.db.select().from(customers))[0]!.name,'Khách Sapo','source never acquires an existing nonblank name');
});

test('AppSheet deletion tombstones, rejected quarantine, contact parent constraints and source namespaces', async () => {
  const s=await setup(),v=input();v.customers[0]!.fields.approvalStatus='Đợi duyệt';assert.equal((await s.apply(v)).status,200);
  const [c]=await s.db.select().from(customers);assert.equal((await s.call('/customers/'+c!.id,s.mgr,'DELETE')).status,200);
  const retry=await s.apply(v);assert.equal(retry.data.reports[0].action,'blocked');assert.equal(retry.data.reports[1].action,'blocked');assert.equal((await s.db.select().from(customers)).length,0);
  const rejected=input();rejected.appId='other-app';rejected.customers[0]!.fields.approvalStatus='Từ chối';const q=await s.apply(rejected);
  assert.equal(q.data.summary.quarantine,1);assert.equal((await s.db.select().from(customers)).length,0);
  rejected.customers[0]!.fields.approvalStatus='Đã duyệt';rejected.customers[0]!.updatedAt=later;assert.equal((await s.apply(rejected)).data.summary.create,2);
  const [contact]=await s.db.select().from(customerContacts);await s.db.delete(customerContacts).where(eq(customerContacts.id,contact!.id));
  assert.equal((await s.apply(rejected)).data.reports[1].action,'blocked');
  assert.equal((await s.db.select().from(appsheetContactLinks))[0]!.contactId,null);
  const broken=input();broken.appId='third-app';broken.customers=[];broken.contacts[0]!.customerRowId='missing';assert.equal((await s.preview(broken)).data.reports[0].action,'blocked');
});

test('AppSheet simultaneous approved imports cannot duplicate customers or contacts', async () => {
  const s=await setup(),v=input(),p=await s.preview(v);
  const results=await Promise.all([1,2].map(()=>s.call('/appsheet-customers/apply',s.mgr,'POST',{input:v,planHash:p.data.planHash})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await s.db.select().from(customers)).length,1);
  assert.equal((await s.db.select().from(customerContacts)).length,1);
  assert.equal((await s.db.select().from(appsheetSyncRuns)).length,1);
});

test('AppSheet retains external identities after merging and rolls back canonical writes if logging fails', async () => {
  const s=await setup(),v=input();assert.equal((await s.apply(v)).status,200);
  const [drop]=await s.db.select().from(customers);
  const {id:_id,...copy}=drop!;await s.db.insert(customers).values({...copy,id:'keep',name:'Khách giữ'});
  await mergeCustomers(s.db,'keep',[drop!.id],'mgr');
  assert.equal((await s.db.select().from(appsheetCustomerLinks))[0]!.customerId,'keep');
  assert.equal((await s.db.select().from(customerContacts))[0]!.customerId,'keep');
  assert.equal((await s.apply(v)).status,200);assert.equal((await s.db.select().from(customers)).length,1);
  const fresh=input();fresh.appId='rollback';fresh.customers[0]!.fields.phone='0987654321';fresh.customers[0]!.fields.taxCode='9999999999';fresh.customers[0]!.fields.customerCode='NEW';fresh.customers[0]!.fields.name='Khách rollback';
  const p=await s.preview(fresh);assert.equal(p.status,200);assert.equal(p.data.summary.create,2);
  await s.client.exec("ALTER TABLE appsheet_sync_runs ADD CONSTRAINT force_log_failure CHECK (app_id <> 'rollback')");
  const result=await s.call('/appsheet-customers/apply',s.mgr,'POST',{input:fresh,planHash:p.data.planHash});assert.equal(result.status,500);
  assert.equal((await s.db.select().from(customers)).length,1);
  assert.equal((await s.db.select().from(appsheetCustomerLinks).where(and(eq(appsheetCustomerLinks.appId,'rollback'),eq(appsheetCustomerLinks.rowId,'KH-1')))).length,0);
});
