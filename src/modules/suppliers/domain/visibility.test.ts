import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { orderVisibility, portalOrderScope, type PortalActor, type PortalOrderRef } from './visibility.ts';

const A = (o: Partial<PortalActor> & { id: string }): PortalActor => ({ role: 'employee', active: true, positionId: null, supplierId: null, ...o });
const O = (o: Partial<PortalOrderRef> = {}): PortalOrderRef => ({ source: 'supplier-order', approvalStatus: 'approved', supplierId: 'S1', ...o });
const mgr = A({ id: 'm', role: 'manager', positionId: 'manager' }), emp = A({ id: 'e', positionId: 'sale' });
const s1 = A({ id: 'n1', role: 'supplier', positionId: 'supplier', supplierId: 'S1' }), s2 = A({ id: 'n2', role: 'supplier', positionId: 'supplier', supplierId: 'S2' });

test('Manager thấy đủ; nhân viên thấy nhưng ẩn giá; NCC chỉ thấy đơn của chính NCC mình', () => {
  assert.equal(orderVisibility(mgr, O()), 'full');
  assert.equal(orderVisibility(emp, O()), 'prices-hidden');
  assert.equal(orderVisibility(s1, O()), 'full');
  assert.equal(orderVisibility(s2, O()), 'none'); // NCC khác – không được thấy đơn của S1
});

test('chỉ đơn NCC đã duyệt hiện ở trang NCC (đơn chờ duyệt, hàng sắp về, phiếu giao hàng thì không)', () => {
  for (const actor of [mgr, emp, s1]) {
    assert.equal(orderVisibility(actor, O({ approvalStatus: 'pending' })), 'none');
    assert.equal(orderVisibility(actor, O({ source: 'incoming-stock' })), 'none');
    assert.equal(orderVisibility(actor, O({ source: 'supplier-delivery-note' })), 'none');
  }
});

test('NCC chưa được gắn vào nhà cung cấp, hoặc đơn chưa có nhà cung cấp, thì không thấy gì', () => {
  assert.equal(orderVisibility(A({ id: 'n3', role: 'supplier', positionId: 'supplier', supplierId: null }), O()), 'none');
  assert.equal(orderVisibility(s1, O({ supplierId: null })), 'none');
  assert.equal(orderVisibility(A({ id: 'n3', role: 'supplier', positionId: 'supplier', supplierId: null }), O({ supplierId: null })), 'none'); // null ≠ null
});

test('tài khoản bị khoá không thấy gì; chức vụ NCC mà vai trò lệch vẫn bị coi là NCC (không được thấy đơn NCC khác, không được ưu đãi nhân viên)', () => {
  assert.equal(orderVisibility({ ...mgr, active: false }, O()), 'none');
  assert.equal(orderVisibility({ ...s1, active: false }, O()), 'none');
  const skewed = A({ id: 'x', role: 'employee', positionId: 'supplier', supplierId: 'S2' });
  assert.equal(orderVisibility(skewed, O()), 'none');
  assert.equal(orderVisibility(A({ id: 'x', role: 'manager', positionId: 'supplier', supplierId: 'S1' }), O()), 'full'); // đúng NCC của mình
  assert.equal(orderVisibility(A({ id: 'x', role: 'employee', positionId: 'supplier', supplierId: null }), O()), 'none'); // không rơi xuống nhánh nhân viên
});

test('SQL lọc danh sách khớp hoàn toàn với hàm kiểm tra từng đơn (mọi tổ hợp người xem × đơn)', () => {
  const orders = [
    { id: 'o1', ...O() }, { id: 'o2', ...O({ supplierId: 'S2' }) }, { id: 'o3', ...O({ approvalStatus: 'pending' }) },
    { id: 'o4', ...O({ source: 'incoming-stock', supplierId: null }) }, { id: 'o5', ...O({ supplierId: null }) }, { id: 'o6', ...O({ source: 'supplier-delivery-note' }) },
  ];
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE incoming_shipments (id TEXT, source TEXT, approval_status TEXT, supplier_id TEXT)');
  for (const o of orders) db.prepare('INSERT INTO incoming_shipments VALUES (?,?,?,?)').run(o.id, o.source, o.approvalStatus, o.supplierId);
  const actors = [mgr, emp, s1, s2, A({ id: 'n3', role: 'supplier', positionId: 'supplier' }), { ...mgr, active: false }, { ...s1, active: false }, A({ id: 'x', role: 'employee', positionId: 'supplier', supplierId: 'S1' })];
  for (const actor of actors) {
    const s = portalOrderScope(actor);
    const viaSql = (db.prepare(`SELECT o.id FROM incoming_shipments o WHERE ${s.sql} ORDER BY o.id`).all(...s.bindings) as { id: string }[]).map(r => r.id);
    const viaFn = orders.filter(o => orderVisibility(actor, o) !== 'none').map(o => o.id);
    assert.deepEqual(viaSql, viaFn, `${actor.id} ${actor.role}`);
  }
});
