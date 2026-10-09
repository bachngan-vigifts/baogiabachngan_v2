import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const }))
    .headers.get('set-cookie')!.split(';')[0]!;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('bảng lương công ty: tham số theo tháng, DS nhóm, thưởng quý tự tính, chốt cả bảng, phiếu đã chốt không đổi khi sửa tham số', async () => {
  const { call, emp, mgr } = await setup();
  const M = '2026-09';
  // Tham số: mặc định theo file mẫu; lưu bản áp dụng từ T9 không ảnh hưởng T8.
  const s0 = (await call('/hr/settings?month=2026-08', mgr)).data;
  assert.equal(s0.params.standardDays, 26); assert.equal(s0.params.kpiHighRate, 0.012); assert.ok(s0.fields.length > 30);
  assert.equal((await call('/hr/settings', emp)).status, 403);
  assert.equal((await call('/hr/settings', mgr, 'PUT', { effectiveMonth: M, params: { kpiHighRate: 1.5 } })).status, 400, 'tỷ lệ phải ≤ 1');
  assert.equal((await call('/hr/settings', mgr, 'PUT', { effectiveMonth: M, params: { ...s0.params, kpiHighRate: 0.01 } })).status, 200);
  assert.equal((await call(`/hr/settings?month=${M}`, mgr)).data.params.kpiHighRate, 0.01);
  assert.equal((await call('/hr/settings?month=2026-08', mgr)).data.params.kpiHighRate, 0.012);

  // Hồ sơ lương: emp (Sale, KPI), new (Lock, thưởng nhóm), old (Bách Ngân, thưởng nhóm).
  const salary = (id: string, body: object) => call(`/hr/members/${id}/salary`, mgr, 'PUT', { effectiveMonth: '2026-07', insurance: 496_650, ...body });
  assert.equal((await salary('emp', { payrollGroup: 'sale', positionLabel: 'SALE', kpiEnabled: true, revenueTarget: 100_000_000, bankCode: 'vcb', bankAccount: '0123' })).status, 200);
  assert.equal((await salary('new', { payrollGroup: 'lock', positionLabel: 'NVBH', responsibilityMode: 'per_day', teamBonus: true })).status, 200);
  assert.equal((await salary('old', { payrollGroup: 'bn', positionLabel: 'NVBH', responsibilityMode: 'per_day', teamBonus: true })).status, 200);
  // DS nhóm + chi thưởng quý (T9 là tháng cuối quý 3).
  assert.equal((await call(`/hr/months/${M}`, mgr, 'PUT', { bnRevenue: 400_000_000, bnAvgRevenue: 380_000_000, lockRevenue: 300_000_000, payQuarterBonus: true })).status, 200);
  for (const m of ['2026-07', '2026-08', M]) await call(`/hr/members/emp/inputs/${m}`, mgr, 'PUT', { revenue: 100_000_000, workDays: 26, kpiOverride: 1 });
  for (const id of ['new', 'old']) await call(`/hr/members/${id}/inputs/${M}`, mgr, 'PUT', { workDays: 26 });

  assert.equal((await call(`/hr/payroll/${M}`, emp)).status, 403);
  const b = (await call(`/hr/payroll/${M}`, mgr)).data;
  const row = (id: string) => b.rows.find((r: any) => r.member.id === id).payslip;
  const line = (id: string, k: string) => [...row(id).income, ...row(id).deductions].find((l: any) => l.key === k).amount;
  assert.equal(line('emp', 'kpiBonus'), 1_000_000, 'tham số T9: 1% × 100tr');
  assert.equal(b.quarter.fund, 1_500_000); assert.equal(line('emp', 'quarterBonus'), 1_500_000, 'đạt 100% chỉ tiêu quý → 0,5% × 300tr');
  assert.equal(line('new', 'salesBonus'), 1_500_000, 'Lock: 300tr ≥ sàn → 1% ÷ 2');
  assert.equal(line('old', 'salesBonus'), 2_000_000, 'Bách Ngân: 400tr / 380tr ≥ 100% → 1% ÷ 2');
  assert.equal(line('old', 'meal'), 1_250_000, 'Bách Ngân trừ 1 ngày cơm');
  assert.match(b.rows.find((r: any) => r.member.id === 'emp').qr, /vcb-0123\.png\?amount=/);
  const sale = b.totals.find((t: any) => t.group === 'sale');
  assert.equal(sale.people, b.rows.filter((r: any) => r.payslip.group === 'sale').length);
  assert.equal(sale.net, b.rows.filter((r: any) => r.payslip.group === 'sale').reduce((s: number, r: any) => s + r.payslip.net, 0));

  // Chốt cả bảng (chỉ người đã có hồ sơ lương); chốt rồi thì sửa tham số không làm đổi phiếu.
  const net = row('emp').net;
  assert.equal((await call(`/hr/payroll/${M}/confirm`, mgr, 'POST', {})).data.confirmed, 3);
  assert.equal((await call(`/hr/payroll/${M}/confirm`, mgr, 'POST', {})).data.confirmed, 0);
  await call('/hr/settings', mgr, 'PUT', { effectiveMonth: M, params: { ...s0.params, kpiHighRate: 0.012 } });
  const after = (await call(`/hr/payroll/${M}`, mgr)).data.rows.find((r: any) => r.member.id === 'emp').payslip;
  assert.equal(after.status, 'confirmed'); assert.equal(after.net, net);
  assert.equal((await call(`/hr/members/emp/inputs/${M}`, mgr, 'PUT', { revenue: 1 })).status, 409, 'tháng đã chốt: khoá số liệu');
  // Nhân viên xem phiếu đã chốt của mình.
  const mine = (await call(`/members/emp/overview?month=${M}`, emp)).data.payroll;
  assert.equal(mine.payslip.status, 'confirmed'); assert.equal(mine.payslip.net, net); assert.equal(mine.locked, true);
});
