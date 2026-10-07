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
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('bảng lương Lock trong hệ thống: mức lương + số liệu tháng → phiếu có từng dòng, chốt lương giữ nguyên dòng, bảng lương tổng cho Manager', async () => {
  const { call, emp, mgr } = await setup();
  const month = vietnamDate().iso.slice(0, 7), day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;

  // Chỉ Manager đặt cách tính và nhập số liệu tháng.
  const salary = { effectiveMonth: month, baseSalary: 4_758_000, standardDays: 26, insurance: 496_650, scheme: 'lock', params: { capabilityCoef: 1, responsibility: 20_000, responsibilityMode: 'per_day', meal: true } };
  assert.equal((await call('/hr/members/emp/salary', emp, 'PUT', salary)).status, 403);
  assert.equal((await call('/hr/members/emp/salary', mgr, 'PUT', { ...salary, scheme: 'luong-la' })).status, 400, 'cách tính lạ');
  assert.equal((await call('/hr/members/emp/salary', mgr, 'PUT', salary)).status, 200);
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, emp, 'PUT', { inputs: { revenue: 1 } })).status, 403);
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { inputs: { hack: 1 } })).status, 400, 'khoản lạ');
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { inputs: { revenue: -5 } })).status, 400, 'số âm');
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { inputs: { revenue: 310_252_962, attendanceBonus: 200_000 } })).status, 200);

  // 26 ngày công đủ (T2–T7 bất kể tháng nào: chấm 26 ngày đầu cho đơn giản).
  const days: Record<string, string> = {}; for (let d = 1; d <= 26; d++) days[day(d)] = 'present';
  assert.equal((await call(`/hr/members/emp/attendance/${month}`, mgr, 'PUT', { days })).status, 200);

  // Phiếu tạm tính: 4.758.000 + 200.000 (năng lực) + 520.000 (trách nhiệm) + 1.300.000 (cơm xăng) + 200.000 (chuyên cần) + thưởng DS 2.326.897 − BHXH 496.650.
  const overview = async (cookie: string) => (await call(`/members/emp/overview?month=${month}`, cookie)).data.payroll;
  let p = await overview(emp);
  assert.equal(p.payslip.scheme, 'lock'); assert.equal(p.payslip.status, 'estimate');
  assert.equal(p.payslip.gross, 4_758_000 + 200_000 + 520_000 + 1_300_000 + 200_000 + 2_326_897);
  assert.equal(p.payslip.net, p.payslip.gross - 496_650);
  assert.ok(p.payslip.lines.some((l: any) => l.key === 'reward' && l.amount === 2_326_897), 'có dòng thưởng DS team');
  assert.equal(p.inputs.revenue, 310_252_962);

  // Chốt lương: dòng được chụp lại; sửa số liệu tháng bị khoá; mở lại thì tính lại.
  assert.equal((await call(`/hr/members/emp/payslips/${month}`, mgr, 'POST', {})).status, 201);
  assert.equal((await call(`/hr/members/emp/inputs/${month}`, mgr, 'PUT', { inputs: { revenue: 1 } })).status, 409);
  p = await overview(emp);
  assert.equal(p.payslip.status, 'confirmed'); assert.equal(p.payslip.scheme, 'lock');
  assert.equal(p.payslip.net, 4_758_000 + 200_000 + 520_000 + 1_300_000 + 200_000 + 2_326_897 - 496_650);
  assert.deepEqual(p.payslip.lines.filter((l: any) => l.type === 'deduction').map((l: any) => [l.key, l.amount]), [['bhxh', 496_650]]);

  // Bảng lương tổng: chỉ Manager; có dòng của nhân viên đã đặt mức lương, kèm tổng.
  assert.equal((await call(`/hr/payroll/${month}`, emp)).status, 403);
  assert.equal((await call('/hr/payroll/2026-13', mgr)).status, 400);
  const all = (await call(`/hr/payroll/${month}`, mgr)).data;
  const row = all.rows.find((r: any) => r.id === 'emp');
  assert.ok(row && row.status === 'confirmed' && row.scheme === 'lock'); assert.equal(row.net, p.payslip.net);
  assert.equal(all.total.net, all.rows.reduce((s: number, r: any) => s + r.net, 0));
  assert.ok(!all.rows.some((r: any) => r.id === 'mgr'), 'chưa đặt mức lương thì không có trong bảng lương');
});
