import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { autoQuoteHead, nextQuoteNoAfter, quoteHeadFor } from '../../src/modules/quotes/domain/quote-number.ts';

/**
 * SỐ BÁO GIÁ không trùng giữa các nhân viên: trước đây mỗi người tự đếm trên báo giá của mình nên ai cũng ra `_001`.
 * Nay máy chủ cấp số theo toàn công ty: số tự sinh bị trùng → tự đổi sang số kế tiếp; số gõ tay bị trùng → báo lỗi.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('emp2','emp2@x.vn','Tên emp2','0900','employee','sale',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,version) VALUES (?,?,0)').run('emp2', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), emp2: await login('emp2@x.vn'), mgr: await login('mgr@x.vn') };
}
const quote = (quoteNo: string, type = 'HRC') => ({ type, quoteNo, customer: 'Khách A', vat: 8, date: '2026-10-09', rows: [{ name: 'Bộ trà', qty: 1, price: 100000 }] });

test('số báo giá: hàm thuần nhận mẫu tự sinh và tính số kế tiếp', () => {
  assert.equal(quoteHeadFor('VIGIFTS', '2026-10-09'), 'VG_BG20261009_');
  assert.equal(autoQuoteHead('HRC_BG20261009_001'), 'HRC_BG20261009_');
  assert.equal(autoQuoteHead('BG-KHACH-01'), null);
  assert.equal(nextQuoteNoAfter('HRC_BG20261009_', ['HRC_BG20261009_001', 'HRC_BG20261009_007', 'B2B_BG20261009_020']), 'HRC_BG20261009_008');
  assert.equal(nextQuoteNoAfter('HRC_BG20261009_', []), 'HRC_BG20261009_001');
});

test('số báo giá: hai nhân viên cùng tạo _001 → người sau tự nhận _002; số gõ tay trùng bị từ chối; gợi ý số kế tiếp theo toàn công ty', async () => {
  const { call, emp, emp2, mgr } = await setup();
  const a = await call('/quotes', emp, 'POST', quote('HRC_BG20261009_001'));
  const b = await call('/quotes', emp2, 'POST', quote('HRC_BG20261009_001'));
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.data.data.quoteNo, 'HRC_BG20261009_001');
  assert.equal(b.data.data.quoteNo, 'HRC_BG20261009_002', 'người sau tự nhận số kế tiếp');
  assert.equal((await call(`/quotes/${b.data.id}`, emp2)).data.data.quoteNo, 'HRC_BG20261009_002', 'số đã lưu đúng');
  // Gợi ý số kế tiếp đếm cả báo giá người khác (emp2 không thấy báo giá của emp).
  assert.equal((await call('/quotes/next-no?type=HRC&date=2026-10-09', emp2)).data.quoteNo, 'HRC_BG20261009_003');
  assert.equal((await call('/quotes/next-no?type=VIGIFTS&date=2026-10-09', emp2)).data.quoteNo, 'VG_BG20261009_001', 'đếm riêng theo loại');
  assert.equal((await call('/quotes/next-no?type=HRC&date=bad', emp2)).status, 400);

  // Số gõ tay trùng → lỗi rõ ràng, không lưu.
  assert.equal((await call('/quotes', emp, 'POST', quote('BG-RIENG-01'))).status, 201);
  const dup = await call('/quotes', emp2, 'POST', quote('BG-RIENG-01'));
  assert.deepEqual([dup.status, dup.data.code], [400, 'QUOTE_NO_EXISTS']);

  // Sửa báo giá giữ nguyên số: không bị đổi số; đổi sang số người khác đang dùng: số tự sinh → số kế tiếp, số gõ tay → lỗi.
  const keep = await call(`/quotes/${a.data.id}`, emp, 'PUT', { revision: 1, data: { ...quote('HRC_BG20261009_001'), customer: 'Khách A sửa' } });
  assert.equal(keep.data.data.quoteNo, 'HRC_BG20261009_001');
  const moved = await call(`/quotes/${a.data.id}`, emp, 'PUT', { revision: keep.data.revision, data: quote('HRC_BG20261009_002') });
  assert.equal(moved.data.data.quoteNo, 'HRC_BG20261009_003');
  const clash = await call(`/quotes/${a.data.id}`, mgr, 'PUT', { revision: moved.data.revision, data: quote('BG-RIENG-01') });
  assert.deepEqual([clash.status, clash.data.code], [400, 'QUOTE_NO_EXISTS']);
});
