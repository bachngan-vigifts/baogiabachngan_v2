import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayslip, monthRange, shiftMonth, summarizeAttendance, targetPercent, EMPTY_PROFILE } from './payroll.ts';

test('tháng: số ngày, đầu / cuối tháng, cộng trừ tháng qua năm', () => {
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29', next: '2024-03-01', days: 29 });
  assert.equal(monthRange('2026-12').next, '2027-01-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-10', -5), '2026-05');
});

test('ngày công: đủ công 1, nửa công 0,5, nghỉ có lương 1, nghỉ không lương / vắng 0', () => {
  const s = summarizeAttendance([{ status: 'present' }, { status: 'present' }, { status: 'half' }, { status: 'paid_leave' }, { status: 'unpaid_leave' }, { status: 'absent' }, { status: 'la' }]);
  assert.deepEqual(s, { worked: 3.5, present: 2, half: 1, paidLeave: 1, unpaidLeave: 1, absent: 1, recorded: 6 });
});

test('phiếu lương: lương theo ngày công + phụ cấp + thưởng + hoa hồng − khấu trừ − bảo hiểm − tạm ứng', () => {
  const p = computePayslip({
    profile: { baseSalary: 10_400_000, allowance: 1_000_000, standardDays: 26, revenueTarget: 100_000_000, commissionRate: 2, insurance: 500_000 },
    workedDays: 24.5, revenue: 50_000_000,
    adjustments: [{ kind: 'bonus', amount: 300_000 }, { kind: 'bonus', amount: 200_000 }, { kind: 'allowance', amount: 100_000 }, { kind: 'deduction', amount: 50_000 }, { kind: 'advance', amount: 2_000_000 }],
  });
  assert.equal(p.salaryByDays, 9_800_000);
  assert.equal(p.commission, 1_000_000);
  assert.equal(p.gross, 9_800_000 + 1_000_000 + 100_000 + 500_000 + 1_000_000);
  assert.equal(p.net, p.gross - 50_000 - 500_000 - 2_000_000);
  assert.equal(computePayslip({ profile: { ...EMPTY_PROFILE, standardDays: 0 }, workedDays: 0, revenue: 0, adjustments: [] }).standardDays, 26, 'ngày công chuẩn 0 → mặc định 26');
});

test('% hoàn thành chỉ tiêu', () => {
  assert.equal(targetPercent(45_000_000, 60_000_000), 75);
  assert.equal(targetPercent(1, 3), 33.3);
  assert.equal(targetPercent(10, 0), null);
});
