import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('hồ sơ đồng nghiệp payroll=null vẫn render; không có thẻ/tab lương hoặc ngày công dù yêu cầu tab lương', async () => {
  const root = { innerHTML: '', addEventListener() {}, querySelectorAll: () => [] };
  const breadcrumb = { textContent: '' };
  const context: any = { avAttr: () => '', document: { getElementById: (id: string) => id === 'member-detail' ? root : breadcrumb }, location: { hash: '' } };
  const source = readFileSync(new URL('../../trial-ui/member-detail.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function initMemberDetail', 'globalThis.init = function');
  runInNewContext(source, context);
  const data = { member: { id: 'new', name: 'Đồng nghiệp', positionId: 'sale', position: 'Sale', active: true, role: 'employee', email: '', phone: '', createdAt: '2026-01-01' }, month: '2026-10', access: { isSelf: false, canManage: false, canViewPayroll: false }, payroll: null,
    kpi: { revenue: 100000, orders: 1, avgOrder: 100000, revenueTarget: 0, targetPercent: null, quotes: 1, quotesWon: 0, conversion: 0, collected: 0, contractsSigned: 0, customers: 0, newCustomers: 0, workedDays: null, standardDays: null, debt: { balance: 0, overdue: 0, orders: 0 }, tasks: { done: 0, open: 0, overdue: 0 } }, trend: [], customers: [], quotes: [], orders: [], contracts: [], payments: [], debts: [] };
  const ui = context.init({ api: async () => data, toast() {}, esc: String, money: String, fmtDate: String, pill: () => '', payCell: String, initials: () => 'ĐN', ORDER_STATUS: {}, CONTRACT_STATUS: {} });
  await ui.open('new', '2026-10', 'payroll');
  assert.match(root.innerHTML, /Đồng nghiệp/); assert.match(root.innerHTML, /Doanh số tháng/);
  assert.doesNotMatch(root.innerHTML, /Không mở được hồ sơ|md-salary-card|data-tab="payroll"|data-tab="attendance"|Lương &amp; thưởng|Lương & thưởng/);
});
