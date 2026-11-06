import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function render(access: Record<string, boolean>) {
  const source = readFileSync(new URL('../../trial-ui/customer-detail.js', import.meta.url), 'utf8');
  const root = { dataset: {}, innerHTML: '', querySelectorAll: () => [] };
  const context = {
    root, st: { tab: 'overview', d: {
      customer: { id: 'shared-customer', name: 'Khách chia sẻ', approvalStatus: 'approved' },
      access, contacts: [{ id: 'contact-1', name: 'Liên hệ', isPrimary: true }], shared: [], stats: {},
    } }, TABS: [], BRANDS: [], deps: {}, esc: (s: unknown) => String(s ?? ''), money: String,
    renderGeneralNote() {}, renderDebtNote() {},
  };
  runInNewContext(source.slice(source.indexOf('  function render()'), source.indexOf('  // Ghi chú nội bộ')) + '\nrender();', context);
  return root.innerHTML;
}

test('shared customer profile exposes edit/contact actions without delegation or discount actions', () => {
  const html = render({ canEditProfile: true, canEdit: false, canManageStaff: false, canSeeAll: true });
  for (const action of ['data-act="edit"', 'data-act="contact"', 'data-contact-edit=', 'data-contact-rep=']) assert.ok(html.includes(action), action);
  assert.ok(!html.includes('data-act="staff"')); assert.ok(!html.includes('data-act="brand-discounts"'));
});

test('read-only and revoked shares hide profile editing, including company-wide viewers', () => {
  const html = render({ canEditProfile: false, canEdit: false, canManageStaff: false, canSeeAll: true });
  for (const action of ['data-act="edit"', 'data-act="contact"', 'data-contact-edit=', 'data-contact-rep=']) assert.ok(!html.includes(action), action);
});

test('customer profile remains compatible with an older API response for owner/manager', () => {
  const html = render({ canEdit: true, canManageStaff: true, canSeeAll: true });
  assert.ok(html.includes('data-act="edit"')); assert.ok(html.includes('data-act="contact"'));
  assert.ok(html.includes('data-act="staff"')); assert.ok(html.includes('data-act="brand-discounts"'));
});
