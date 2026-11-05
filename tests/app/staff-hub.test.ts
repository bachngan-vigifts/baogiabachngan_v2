import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('chi tiết nhân viên: KPI tháng, khách / báo giá / đơn / HĐKT / giao dịch / công nợ, lương – ngày công – thưởng; quyền xem / sửa; chốt lương khoá tháng', async t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-31T02:00:00Z')});
  const { call, emp, mgr } = await setup();
  const month = vietnamDate().iso.slice(0, 7), day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;

  // Doanh số: nhân viên lập 2 báo giá, 1 báo giá lên đơn 2.160.000, khách trả 1.000.000.
  const kh = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Hoàng Long' }));
  const doc = { type: 'B2B', customer: 'Công ty Hoàng Long', customerId: kh.data.id, vat: 8, rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 10, price: 200000, taxRate: 8, commission:{excluded:true} }] };
  const q = await call('/quotes', emp, 'POST', { ...doc, quoteNo: 'B2B_1' });
  await call('/quotes', emp, 'POST', { ...doc, quoteNo: 'B2B_2' });
  const source=(await call('/quotes/'+q.data.id,mgr)).data;
  const reviewed=await call('/quotes/'+q.data.id,mgr,'PUT',{revision:source.revision,data:{...source.data,rows:source.data.rows.map((r:any)=>({...r,commission:{excluded:true}}))}});
  assert.equal(reviewed.status,200);
  await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: reviewed.data.revision });
  const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201);
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 1_000_000, paidAt: day(2), method: 'transfer' })).status, 201);

  // Quyền: nhân viên không xem hồ sơ người khác, không sửa lương.
  assert.equal((await call('/members/mgr/overview', emp)).status, 403);
  assert.equal((await call('/hr/members/emp/salary', emp, 'PUT', { effectiveMonth: month, baseSalary: 1 })).status, 403);
  assert.equal((await call('/members/khong-co/overview', mgr)).status, 404);

  // Manager đặt lương, chấm công, thưởng / tạm ứng.
  assert.equal((await call('/hr/members/emp/salary', mgr, 'PUT', { effectiveMonth: month, payrollGroup: 'sale', positionLabel: 'sale', baseSalary: 10_400_000, capacityCoef: 1,
    mealAllowance: false, kpiEnabled: true, revenueTarget: 4_320_000, insurance: 500_000, bankCode: 'VCB', bankAccount: '0123 456', bankHolder: 'Ten emp' })).status, 200);
  assert.equal((await call('/hr/members/emp/salary', mgr, 'PUT', { effectiveMonth: month, payrollGroup: 'khac' })).status, 400);
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, emp, 'PUT', { kpiOverride: 0.95 })).status, 403);
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { kpiOverride: 0.95 })).status, 200, 'KPI chốt 95% → thưởng 1% doanh số net');
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { overtimeHours: -1 })).status, 400);
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days: { [day(1)]: 'present', [day(2)]: 'present', [day(3)]: 'half', [day(4)]: 'absent' } })).status, 200);
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days: { [day(4)]: '' } })).status, 200, 'xoá chấm công một ngày');
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days: { '2020-01-01': 'present' } })).status, 400, 'ngày ngoài tháng');
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days: { [day(5)]: 'đi chơi' } })).status, 400);
  const bonus = await call('/hr/members/emp/adjustments', mgr, 'POST', { month, kind: 'bonus', amount: 500_000, reason: 'Vượt chỉ tiêu' });
  assert.equal(bonus.status, 201);
  await call('/hr/members/emp/adjustments', mgr, 'POST', { month, kind: 'advance', amount: 1_000_000, reason: 'Tạm ứng' });
  assert.equal((await call('/hr/members/emp/adjustments', mgr, 'POST', { month, kind: 'bonus', amount: -5 })).status, 400);

  // Nhân viên xem hồ sơ của chính mình.
  const d = (await call(`/members/emp/overview?month=${month}`, emp)).data;
  assert.deepEqual(d.access, { isSelf: true, canManage: false, canViewPayroll: true });
  assert.equal(d.member.name, 'Tên emp');
  assert.equal(d.kpi.revenue, 2_160_000); assert.equal(d.kpi.orders, 1); assert.equal(d.kpi.targetPercent, 50);
  assert.equal(d.kpi.quotes, 2); assert.equal(d.kpi.quotesWon, 1); assert.equal(d.kpi.conversion, 50);
  assert.equal(d.kpi.collected, 1_000_000); assert.equal(d.kpi.workedDays, 2.5);
  assert.equal(d.kpi.debt.balance, 1_160_000);
  assert.deepEqual(d.customers.map((k: any) => [k.name, k.orders, k.revenue]), [['Công ty Hoàng Long', 1, 2_160_000]]);
  assert.equal(d.quotes.length, 2); assert.equal(d.quotes.find((x: any) => x.id === q.data.id).orderId, o.data.id);
  assert.equal(d.orders.length, 1); assert.equal(d.payments[0].amount, 1_000_000); assert.equal(d.debts[0].balance, 1_160_000);
  assert.equal(d.trend.length, 6); assert.equal(d.trend.at(-1).month, month); assert.equal(d.trend.at(-1).revenue, 2_160_000);
  const p = d.payroll.payslip;
  assert.equal(p.status, 'estimate');
  const line = (k: string) => [...p.income, ...p.deductions].find((l: any) => l.key === k).amount;
  assert.equal(p.group, 'sale'); assert.equal(p.workDays, 2.5, 'ngày công theo chấm công');
  assert.equal(line('salaryByDays'), 1_000_000); assert.equal(line('capacity'), 200_000); assert.equal(line('kpiBonus'), 20_000, '1% × doanh số chưa VAT 2.000.000, đã xác nhận không hoa hồng');
  assert.equal(line('otherBonus'), 500_000); assert.equal(line('meal'), 0, 'không hưởng cơm-xăng');
  assert.equal(p.gross, 1_720_000); assert.equal(line('socialInsurance'), 500_000); assert.equal(line('advance'), 1_000_000); assert.equal(p.net, 220_000);
  assert.equal(d.payroll.profile.bankCode, 'vcb'); assert.equal(d.payroll.profile.bankAccount, '0123456'); assert.equal(d.payroll.profile.positionLabel, 'SALE');
  assert.equal(d.payroll.attendance.length, 3); assert.equal(d.payroll.adjustments.length, 2);

  const confirm=async()=>{const fresh=(await call(`/members/emp/overview?month=${month}`,mgr)).data.payroll;return call(`/hr/members/emp/payslips/${month}`,mgr,'POST',{confirmationHash:fresh.confirmationHash});};
  // Chốt lương: tháng bị khoá; mở lại được khi chưa trả; đã trả thì không mở lại.
  assert.equal((await call(`/hr/members/emp/payslips/${month}`, emp, 'POST', {})).status, 403);
  assert.equal((await confirm()).status, 201);
  assert.equal((await confirm()).status, 409);
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days: { [day(6)]: 'present' } })).status, 409);
  assert.equal((await call(`/hr/adjustments/${bonus.data.id}`, mgr, 'DELETE')).status, 409);
  const locked = (await call(`/members/emp/overview?month=${month}`, mgr)).data.payroll;
  assert.equal(locked.locked, true); assert.equal(locked.payslip.status, 'confirmed'); assert.equal(locked.payslip.net, p.net);
  assert.equal((await call(`/hr/members/emp/payslips/${month}`, mgr, 'DELETE')).status, 200);
  assert.equal((await call(`/hr/adjustments/${bonus.data.id}`, mgr, 'DELETE')).status, 200);
  await confirm();
  assert.equal((await call(`/hr/members/emp/payslips/${month}/paid`,mgr,'POST',{})).status,409,'bỏ thưởng làm phiếu âm: cần đối soát trước khi đánh dấu đã trả');
  assert.equal((await call(`/hr/members/emp/payslips/${month}`,mgr,'DELETE')).status,200);
  assert.equal((await call('/hr/members/emp/adjustments',mgr,'POST',{month,kind:'bonus',amount:500_000,reason:'Khoản bổ sung đã được Manager đối soát'})).status,201);
  assert.equal((await confirm()).status,201);
  assert.equal((await call(`/hr/members/emp/payslips/${month}/paid`, mgr, 'POST', {})).status, 200);
  assert.equal((await call(`/hr/members/emp/payslips/${month}`, mgr, 'DELETE')).status, 409, 'đã trả lương thì không mở lại');
  assert.equal((await call(`/members/emp/overview?month=${month}`, emp)).data.payroll.payslip.status, 'paid');
});

