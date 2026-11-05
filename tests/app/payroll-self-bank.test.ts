import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {webNotifications} from '../../src/modules/notifications/schema.ts';
import {hrSalaryProfiles} from '../../src/modules/hr/schema.ts';

/** Nhân viên tự điền tài khoản nhận lương ở "Hồ sơ của tôi"; mã VietQR chuyển lương tạo sẵn số tiền + nội dung "Chuyen luong T10". */
const bank={bankCode:'VCB',bankAccount:'0123 456 789',bankHolder:'Nguyễn Văn Đức'};

test('nhân viên tự điền tài khoản: chuẩn hoá, áp mọi bản hồ sơ, ghi nhật ký, báo Manager, QR đúng số tiền và nội dung',async()=>{
 const f=await setupSalesPayroll();
 assert.equal((await f.call('/hr/me/bank',f.emp,'PUT',bank)).status,409,'chưa có hồ sơ lương');
 assert.equal((await f.salary()).status,200);
 assert.equal((await f.call('/hr/members/emp/salary',f.mgr,'PUT',{effectiveMonth:'2026-11',payrollGroup:'sale',kpiEnabled:true,contractBonusEnabled:true,baseSalary:1_000_000})).status,200);
 assert.equal((await f.overview(f.emp)).data.payroll.transfer.qr,'','chưa có tài khoản → chưa có QR');
 assert.equal((await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{workDays:26})).status,200);
 const r=await f.call('/hr/me/bank',f.emp,'PUT',bank);assert.equal(r.status,200);assert.equal(r.data.changed,true);
 const rows=await f.db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId,'emp'));
 assert.equal(rows.length,2);for(const p of rows)assert.deepEqual([p.bankCode,p.bankAccount,p.bankHolder],['vcb','0123456789','NGUYEN VAN DUC']);
 const t=(await f.overview(f.emp)).data.payroll.transfer, net=(await f.overview(f.emp)).data.payroll.payslip.net;
 assert.ok(net>0);assert.equal(t.amount,Math.round(net));assert.equal(t.note,'Chuyen luong T10');assert.equal(t.bankAccount,'0123456789');
 const qr=new URL(t.qr);assert.equal(qr.pathname,'/image/vcb-0123456789.png');assert.equal(qr.searchParams.get('amount'),String(Math.round(net)));
 assert.equal(qr.searchParams.get('addInfo'),'Chuyen luong T10');assert.equal(qr.searchParams.get('accountName'),'NGUYEN VAN DUC');
 const logs=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'hr-salary-profile-update'));
 const self=logs.map(l=>JSON.parse(l.data)).filter(d=>d.selfService);assert.equal(self.length,1);assert.equal(self[0].bankChanged,true);assert.doesNotMatch(JSON.stringify(self[0]),/0123456789/);
 const hist=(await f.call('/hr/members/emp/salary-history',f.mgr)).data.items;assert.ok(hist.some((h:any)=>h.selfService&&h.bankChanged));
 const notes=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'hr-bank-changed'));
 assert.deepEqual(notes.map(n=>n.targetMemberId),['mgr']);
 const again=await f.call('/hr/me/bank',f.emp,'PUT',bank);assert.equal(again.data.changed,false,'lưu lại y hệt không ghi nhật ký / không báo');
 assert.equal((await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'hr-bank-changed'))).length,1);
});

test('kiểm tra đầu vào; phiếu đã chốt giữ tài khoản lúc chốt; Manager sửa hồ sơ vẫn giữ tài khoản đã chuẩn hoá',async()=>{
 const f=await setupSalesPayroll();assert.equal((await f.salary()).status,200);
 for(const b of [{...bank,bankCode:''},{...bank,bankAccount:'12ab'},{...bank,bankAccount:'123'},{...bank,bankHolder:''}])assert.equal((await f.call('/hr/me/bank',f.emp,'PUT',b)).status,400,JSON.stringify(b));
 assert.equal((await f.call('/hr/me/bank',f.emp,'PUT',bank)).status,200);
 assert.equal((await f.confirm()).status,201);
 assert.equal((await f.call('/hr/me/bank',f.emp,'PUT',{...bank,bankAccount:'999888777'})).status,200);
 const t=(await f.overview(f.emp)).data.payroll.transfer;assert.equal(t.fromSnapshot,true);assert.equal(t.bankAccount,'0123456789');
 assert.equal((await f.overview(f.emp,'2026-11')).data.payroll.transfer.bankAccount,'999888777','tháng chưa chốt dùng tài khoản mới');
 assert.equal((await f.salary({bankCode:'acb',bankAccount:'111222333',bankHolder:'Trần Thị Đào'})).status,200);
 const [p]=await f.db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId,'emp'));assert.equal(p!.bankHolder,'TRAN THI DAO');
});
