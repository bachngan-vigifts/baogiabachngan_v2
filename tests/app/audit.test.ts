import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { sanitizeForAudit } from '../../src/core/audit.ts';

/**
 * NHẬT KÝ THAY ĐỔI: mọi thao tác ghi thành công (tạo / sửa / duyệt / huỷ…) tự ghi audit_logs; thao tác lỗi, đọc, đăng nhập,
 * tin nhắn không ghi; không lưu mật khẩu / ảnh; chỉ Manager xem (GET /audit), xem được cả thao tác liên quan của một đơn.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(customers).values({ id: 'K1', name: 'Công ty An Phú', contact: 'Anh Phú', phone: '0902', email: '', address: 'Cần Thơ', search: '', taxCode: '0309', customerCode: 'AP01', sourceVersion: 0, syncedAt: '' });
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('nhật ký thay đổi: ghi tự động thao tác thành công, Manager xem theo bản ghi / thao tác liên quan', async () => {
  const { db, call, emp, mgr } = await setup();
  assert.equal((await db.select().from(auditLogs)).length, 0, 'đăng nhập không ghi nhật ký');

  // Nhân viên tạo báo giá, Manager duyệt → 2 dòng, đúng người làm và mã báo giá.
  const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_A1', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows: [{ name: 'Bộ trà', qty: 10, price: 100000 }] });
  assert.equal(q.status, 201);
  assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
  // Thao tác lỗi (sai phiên bản) không ghi.
  assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', {})).status >= 400, true);
  const qHist = (await call(`/audit?entityType=quotes&entityId=${q.data.id}`, mgr)).data.entries;
  assert.deepEqual(qHist.map((e: any) => [e.action, e.actorName]).reverse(), [['POST /quotes', 'Tên emp'], ['POST /quotes/:id/approve', 'Tên mgr']]);
  assert.equal(qHist[1].data.body.quoteNo, 'HRC_A1', 'lưu nội dung thao tác');
  assert.equal(qHist[0].area, 'business');

  // Đơn hàng: tạo, duyệt, lên lịch giao, thu tiền → xem lịch sử đơn kèm thao tác liên quan (giao hàng, phiếu thu có orderId).
  const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201);
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true });
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2030-01-15' })).status, 201);
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 500000, paidAt: '2026-10-09', method: 'transfer' })).status, 201);
  const only = (await call(`/audit?entityType=orders&entityId=${o.data.id}`, mgr)).data.entries.map((e: any) => e.action);
  assert.deepEqual(only.sort(), ['POST /orders', 'PUT /orders/:id/status'].sort());
  const rel = (await call(`/audit?entityType=orders&entityId=${o.data.id}&related=1`, mgr)).data.entries.map((e: any) => e.action);
  for (const a of ['POST /orders', 'PUT /orders/:id/status', 'POST /deliveries', 'POST /payments']) assert.ok(rel.includes(a), `liên quan: ${a}`);

  // Đọc dữ liệu, tin nhắn, báo cáo CSP không ghi; nhân viên không xem được nhật ký.
  const before = (await db.select().from(auditLogs)).length;
  await call('/quotes', emp); await call(`/orders/${o.data.id}`, mgr);
  assert.equal((await call('/csp-report', emp, 'POST', { directive: 'img-src', blocked: 'https://x.test/a.png', page: '/index.html' })).status, 200);
  assert.equal((await call('/csp-report', '', 'POST', { directive: 'img-src' })).status, 401, 'chưa đăng nhập không gửi được');
  assert.equal((await db.select().from(auditLogs)).length, before);
  assert.equal((await call('/audit', emp)).status, 403);
  assert.ok((await call('/audit', mgr)).data.entries.length >= 6, 'Manager xem các thao tác gần nhất');
});

test('nhật ký thay đổi: che mật khẩu / mã bí mật, bỏ ảnh và file, rút gọn chuỗi dài', () => {
  const out = sanitizeForAudit({ email: 'a@b.vn', password: 'bi-mat-123', newPassword: 'x', token: 'abc', photos: ['data:image/jpeg;base64,AAAA'],
    image: 'https://x/' + 'a'.repeat(300), note: 'n'.repeat(400), rows: Array.from({ length: 40 }, (_, i) => i), file: 'data:application/pdf;base64,QQ==' }) as any;
  assert.equal(out.email, 'a@b.vn');
  assert.deepEqual([out.password, out.newPassword, out.token], ['[ẩn]', '[ẩn]', '[ẩn]']);
  assert.equal(out.photos, '[bỏ qua]'); assert.equal(out.image, '[bỏ qua]'); assert.equal(out.file, '[dữ liệu file]');
  assert.equal(out.note.length, 301); assert.equal(out.rows.length, 31);
  assert.ok(!JSON.stringify(out).includes('bi-mat-123'));
});
