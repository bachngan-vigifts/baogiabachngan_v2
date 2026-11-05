import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anniversarySuggestion, isCalendarDate, vietnamToday } from '../../src/modules/customers/domain/anniversary.ts';
import { customerInput } from '../../src/modules/customers/domain/customer-input.ts';
import { bundleCustomerAnniversary, CUSTOMER_ANNIVERSARY_OUT } from '../../scripts/build-trial-ui.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { syncCustomers } from '../../src/modules/integrations/api/sapo-sync-routes.ts';

test('milestone formula: anniversary day, five-year rollover, calendar-year boundaries and leap-day policy', () => {
  const a=anniversarySuggestion('2016-11-20','2026-11-05')!;
  assert.deepEqual([a.years,a.date,a.daysUntil,a.upcoming],[10,'2026-11-20',15,true]);
  assert.equal(anniversarySuggestion('2016-11-05','2026-11-05')!.daysUntil,0);
  assert.equal(anniversarySuggestion('2016-11-04','2026-11-05')!.years,15);
  assert.equal(anniversarySuggestion('2022-01-01','2026-12-31')!.daysUntil,1);
  assert.equal(anniversarySuggestion('2020-02-29','2025-02-28')!.daysUntil,0);
  assert.equal(anniversarySuggestion('2004-02-29','2024-02-01')!.date,'2024-02-29');
  assert.equal(anniversarySuggestion('2021-03-02','2026-01-01')!.upcoming,true,'60 days inclusive');
  assert.equal(anniversarySuggestion('2021-03-03','2026-01-01')!.upcoming,false);
  for(const date of [null,undefined,'','2026-02-30','0000-01-01','2027-01-01']) assert.equal(anniversarySuggestion(date,'2026-11-05'),null);
  assert.equal(anniversarySuggestion('9999-01-01','9999-01-01'),null);
  assert.equal(vietnamToday(new Date('2026-11-04T18:00:00Z')),'2026-11-05');
});

test('customer date input is optional, rejects impossible/future dates and shares generated formula with browser',()=>{
  assert.equal(isCalendarDate('2024-02-29'),true);assert.equal(isCalendarDate('2025-02-29'),false);
  assert.equal(Object.hasOwn(customerInput({name:'A'}).terms,'establishedDate'),false,'old clients preserve the date on update');
  assert.equal(customerInput({name:'A',establishedDate:''}).terms.establishedDate,null);
  for(const value of ['tomorrow','2026-02-30','9999-01-01',123,{},'0000-01-01']) assert.throws(()=>customerInput({name:'A',establishedDate:value}));
  assert.equal(readFileSync(CUSTOMER_ANNIVERSARY_OUT,'utf8'),bundleCustomerAnniversary());
});

test('CRM date create/edit/clear, scoped upcoming reminders, pending customers and sync preservation',async()=>{
  const s=await createTestDb();await seedStaff(s.d1);const router=createAppRouter(),origin='https://trial.test';
  const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
    const r=await router.handle(new Request(origin+'/api/staff'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db:s.db,passwordIterations:1000,sapoOrderPush:'off'});
    return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]??''};
  };
  const login=async(id:string)=>(await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
  const mgr=await login('mgr'),emp=await login('emp'),ncc=await login('ncc');
  const today=vietnamToday(),date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+15);
  const event=date.toISOString().slice(0,10),establishedDate=String(Number(event.slice(0,4))-10)+event.slice(4);
  const create=async(name:string,ownerId:string)=>{
    const r=await call('/customers',mgr,'POST',{name,establishedDate,ownerId});assert.equal(r.status,201,JSON.stringify(r));return r.data.id;
  };
  const mine=await create('Kỷ niệm của sale','emp'),other=await create('Kỷ niệm Manager','mgr'),shared=await create('Kỷ niệm chia sẻ','mgr');
  assert.equal((await call(`/customers/${shared}/staff`,mgr,'PUT',{sharedIds:['emp']})).status,200);
  const pending=await call('/customers',emp,'POST',{name:'Khách chưa duyệt',establishedDate});assert.equal(pending.status,201);
  assert.equal((await call('/customers/anniversaries')).status,401);assert.equal((await call('/customers/anniversaries',ncc)).status,403);
  let reminders=(await call('/customers/anniversaries',emp)).data;
  assert.deepEqual(new Set(reminders.reminders.map((r:any)=>r.id)),new Set([mine,shared]));
  assert.ok(!(reminders.reminders.some((r:any)=>r.id===pending.data.id)));
  assert.equal((await call('/customers/anniversaries',mgr)).data.total,3);
  const profile=(await call(`/customers/${mine}`,emp)).data;
  assert.equal(profile.customer.establishedDate,establishedDate);assert.equal(profile.customer.anniversary.years,10);
  assert.equal((await call(`/customers/${mine}`,emp,'PUT',{name:'Đổi tên, giữ ngày'})).status,200);
  assert.equal((await call(`/customers/${mine}`,emp)).data.customer.establishedDate,establishedDate);
  assert.equal((await call(`/customers/${other}`,emp,'PUT',{name:'Không được sửa',establishedDate:''})).status,403);
  assert.equal((await call(`/customers/${mine}`,emp,'PUT',{name:'Ngày sai',establishedDate:'2026-02-31'})).status,400);
  // Sync only updates mapped fields; founding date remains CRM-owned.
  await syncCustomers(s.db,{customers:[{id:mine,name:'Công ty đồng bộ',tax_code:'1234567890',version:2}]});
  assert.equal((await call(`/customers/${mine}`,emp)).data.customer.establishedDate,establishedDate);
  assert.equal((await call(`/customers/${mine}`,emp,'PUT',{name:'Xóa ngày',establishedDate:''})).status,200);
  assert.equal((await call(`/customers/${mine}`,emp)).data.customer.establishedDate,null);
  assert.equal((await call('/customers/anniversaries',emp)).data.total,1);
  await assert.rejects(s.client.query("update sapo_customers set established_date='2026-02-31' where id=$1",[other]));
});
