import {test} from 'node:test';
import assert from 'node:assert/strict';
const {homeReminderContent}=await import(new URL('../../trial-ui/home-reminder.js',import.meta.url).href);
test('quick reminder preserves full notes and sets self-assignment with valid calendar date',()=>{
 const r=homeReminderContent('  Gọi chị Lan\nHỏi phản hồi về mẫu quà  ','2026-12-01','emp','2026-11-19');
 assert.equal(r.title,'Nhắc chăm sóc: Gọi chị Lan');assert.equal(r.description,'Gọi chị Lan\nHỏi phản hồi về mẫu quà');assert.equal(r.assigneeId,'emp');assert.equal(r.dueDate,'2026-12-01');
 for(const date of ['2026-11-18','2026-02-30','abc','2026-13-01'])assert.throws(()=>homeReminderContent('Gọi khách',date,'emp','2026-11-19'),/ngày nhắc/);
 assert.throws(()=>homeReminderContent(' ','2026-11-19','emp','2026-11-19'),/ghi chú/);
 assert.throws(()=>homeReminderContent('Gọi khách','2026-11-19',null,'2026-11-19'),/Đăng nhập/);
 assert.throws(()=>homeReminderContent('x'.repeat(5001),'2026-11-19','emp','2026-11-19'),/ghi chú/);
 const long=homeReminderContent('x'.repeat(400),'2026-11-19','emp','2026-11-19');assert.equal(long.title.length,300);assert.equal(long.description.length,400);
});
