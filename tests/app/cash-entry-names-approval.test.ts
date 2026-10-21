import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { webNotifications } from '../../src/modules/notifications/schema.ts';
import { cashEntryInput, cashEntryName } from '../../src/modules/sales/domain/cash.ts';

test('custom receipt names are validated, readable and keep accounting direction/kind unchanged',()=>{
 const input=cashEntryInput({kind:'petty_expense',amount:100,reason:'Sửa xe giao hàng',entryName:'Chi sửa xe'});
 assert.equal(input.kind,'petty_expense');assert.equal(input.direction,'out');assert.equal(cashEntryName(input),'Chi sửa xe');
 assert.equal(input.reason,'Tên phiếu: Chi sửa xe\n\nSửa xe giao hàng');
 assert.equal(cashEntryName({kind:'advance',reason:'Phiếu cũ'}),'Tạm ứng');
 for(const entryName of ['',42,'a\nb','x'.repeat(121)])assert.throws(()=>cashEntryInput({kind:'other_income',amount:1,reason:'Ghi chú',entryName}));
 assert.throws(()=>cashEntryInput({kind:'adjustment',direction:'out',amount:1,reason:'Ghi chú',entryName:'Giả chi thường'}));
});

test('pending cash notifies eligible delegated approvers once and opens the exact receipt under existing permissions',async()=>{
 const f=await setup();await f.open();
 await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'cashier2'));
 await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'off'));
 await f.db.insert(employees).values({id:'ml-approver',email:'ml-approver@x.vn',name:'Duyệt cửa hàng khác',role:'employee',positionId:'sales-ml',canApprove:true,createdAt:'2026-10-21'});
 const body={key:crypto.randomUUID(),kind:'petty_expense',entryName:'Chi sửa xe',reason:'Bảo trì xe giao hàng',amount:1500000};
 const saved=await f.call('/cash/entries',f.emp,'POST',body);assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.status,'pending');
 let notices=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'cash_entry_pending'));
 assert.deepEqual(notices.map(n=>n.targetMemberId).sort(),['cashier2','mgr']);
 assert.ok(notices.every(n=>n.body.includes('Chi sửa xe')&&n.url.includes('entryId='+saved.data.id)&&n.url.includes('drawerId=')));
 const replay=await f.call('/cash/entries',f.emp,'POST',body);assert.equal(replay.data.replayed,true);
 notices=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'cash_entry_pending'));assert.equal(notices.length,2);
 assert.equal((await f.call('/cash/entries',f.emp,'POST',{...body,entryName:'Tên khác'})).status,409);
 const detail=await f.call('/cash/entries/'+saved.data.id,f.other);assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.entry.id,saved.data.id);assert.equal(detail.data.entry.photoFileKey,undefined);
 const before=await f.call('/cash',f.mgr);assert.equal(before.data.balance,500000,'pending does not reduce cash');
 const small=await f.call('/cash/entries',f.emp,'POST',{...body,key:crypto.randomUUID(),amount:100});assert.equal(small.data.status,'posted');
 assert.equal((await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'cash_entry_pending'))).length,2);
 await f.db.update(employees).set({canApprove:false}).where(eq(employees.id,'cashier2'));
 assert.equal((await f.call('/cash/entries/'+saved.data.id,f.other)).status,404);
 assert.equal((await f.call('/cash/entries/'+saved.data.id+'/approve',f.other,'POST',{})).status,403);
 assert.equal((await f.db.select().from(cashEntries)).length,2);
});
