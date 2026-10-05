import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { canViewQuotation, canEditQuotation, canShareQuotation, canReassignQuotation, effectiveAssigneeId, quotationScope, quotationEditScope, type Viewer, type QuoteShareTarget } from './access.ts';

const v = (o: Partial<Viewer> & { id: string }): Viewer => ({ role: 'employee', active: true, positionId: null, ...o });
type Q = { id: string; creatorId: string; assigneeId?: string | null };
const quotes: Q[] = [{ id: 'qa', creatorId: 'a' }, { id: 'qb', creatorId: 'b' }, { id: 'qc', creatorId: 'c' }, { id: 'qd', creatorId: 'd' }];
type Share = { quoteId: string; type: 'member' | 'position'; target: string; permission?: 'view' | 'edit' };

function dbWith(shares: Share[] = [], qs: Q[] = quotes) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE staff_quotations (id TEXT, creator_id TEXT, assignee_id TEXT); CREATE TABLE quote_shares (quote_id TEXT, target_type TEXT, target_id TEXT, permission TEXT)');
  for (const q of qs) db.prepare('INSERT INTO staff_quotations VALUES (?,?,?)').run(q.id, q.creatorId, q.assigneeId ?? null);
  for (const s of shares) db.prepare('INSERT INTO quote_shares VALUES (?,?,?,?)').run(s.quoteId, s.type, s.target, s.permission ?? 'edit');
  return db;
}
const ids = (rows: unknown) => (rows as { id: string }[]).map(r => r.id);
const viewList = (db: DatabaseSync, viewer: Viewer) => { const s = quotationScope(viewer); return ids(db.prepare(`SELECT q.id FROM staff_quotations q WHERE ${s.sql} ORDER BY q.id`).all(...s.bindings)); };
const editList = (db: DatabaseSync, viewer: Viewer) => { const s = quotationEditScope(viewer); return ids(db.prepare(`SELECT q.id FROM staff_quotations q WHERE ${s.sql} ORDER BY q.id`).all(...s.bindings)); };
const sharesOf = (shares: Share[], quoteId: string): QuoteShareTarget[] =>
  shares.filter(s => s.quoteId === quoteId).map(s => ({ targetType: s.type, targetId: s.target, permission: s.permission ?? 'edit' }));

test('mặc định nhân viên chỉ thấy và sửa báo giá của chính mình, kể cả khi cùng chức vụ với người khác', () => {
  const db = dbWith();
  const a = v({ id: 'a', positionId: 'sales' }); // b cùng chức vụ 'sales' với a
  assert.deepEqual(viewList(db, a), ['qa']);
  assert.deepEqual(editList(db, a), ['qa']);
  assert.deepEqual(viewList(db, v({ id: 'b', positionId: 'sales' })), ['qb']);
  assert.deepEqual(viewList(db, v({ id: 'x' })), []);
  for (const q of quotes) { assert.equal(canViewQuotation(a, q), q.creatorId === 'a'); assert.equal(canEditQuotation(a, q), q.creatorId === 'a'); }
});

test('manager xem/sửa/chia sẻ tất cả; người bị khoá không làm được gì', () => {
  const db = dbWith();
  const m = v({ id: 'm', role: 'manager' });
  assert.deepEqual(viewList(db, m), ['qa', 'qb', 'qc', 'qd']);
  assert.deepEqual(editList(db, m), ['qa', 'qb', 'qc', 'qd']);
  assert.ok(quotes.every(q => canViewQuotation(m, q) && canEditQuotation(m, q) && canShareQuotation(m, q)));
  const locked = v({ id: 'a', role: 'manager', active: false });
  assert.deepEqual(viewList(db, locked), []);
  assert.deepEqual(editList(db, locked), []);
  assert.ok(quotes.every(q => !canViewQuotation(locked, q) && !canEditQuotation(locked, q) && !canShareQuotation(locked, q)));
});

test('chia sẻ cho một nhân viên với quyền SỬA (mặc định): xem và sửa được, người khác vẫn không thấy', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'member', target: 'x' }];
  const db = dbWith(shares);
  const x = v({ id: 'x' });
  assert.deepEqual(viewList(db, x), ['qa']);
  assert.deepEqual(editList(db, x), ['qa']);
  assert.equal(canEditQuotation(x, quotes[0], sharesOf(shares, 'qa')), true);
  assert.equal(canEditQuotation(x, quotes[1], sharesOf(shares, 'qb')), false); // không lan sang báo giá khác
  assert.deepEqual(viewList(db, v({ id: 'y' })), []);
});

test('chia sẻ quyền XEM: xem được nhưng không sửa được (cả hàm thuần lẫn SQL)', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'member', target: 'x', permission: 'view' }];
  const db = dbWith(shares);
  const x = v({ id: 'x' });
  assert.deepEqual(viewList(db, x), ['qa']);
  assert.deepEqual(editList(db, x), []);
  assert.equal(canViewQuotation(x, quotes[0], sharesOf(shares, 'qa')), true);
  assert.equal(canEditQuotation(x, quotes[0], sharesOf(shares, 'qa')), false);
});

test('người được chia sẻ (kể cả quyền sửa) KHÔNG chia sẻ tiếp hay thu hồi được; chỉ chủ báo giá và manager', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'member', target: 'x', permission: 'edit' }];
  const x = v({ id: 'x' });
  assert.equal(canEditQuotation(x, quotes[0], sharesOf(shares, 'qa')), true);
  assert.equal(canShareQuotation(x, quotes[0]), false);
  assert.equal(canShareQuotation(v({ id: 'a' }), quotes[0]), true);
  assert.equal(canShareQuotation(v({ id: 'a' }), quotes[1]), false);
  assert.equal(canShareQuotation(null, quotes[0]), false);
});

test('chia sẻ cho cả chức vụ: mọi người cùng chức vụ truy cập đúng báo giá đó với đúng quyền', () => {
  const shares: Share[] = [
    { quoteId: 'qb', type: 'position', target: 'ke-toan', permission: 'edit' },
    { quoteId: 'qc', type: 'position', target: 'ke-toan', permission: 'view' },
    { quoteId: 'qd', type: 'position', target: 'khac' },
  ];
  const db = dbWith(shares);
  for (const id of ['x', 'z']) {
    const u = v({ id, positionId: 'ke-toan' });
    assert.deepEqual(viewList(db, u), ['qb', 'qc']);
    assert.deepEqual(editList(db, u), ['qb']);
  }
  assert.deepEqual(viewList(db, v({ id: 'w', positionId: 'ban-hang' })), []);
});

test('khớp nhiều dòng chia sẻ thì quyền cao nhất thắng (xem theo chức vụ + sửa theo tên → sửa được)', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'position', target: 'p', permission: 'view' }, { quoteId: 'qa', type: 'member', target: 'x', permission: 'edit' }];
  const db = dbWith(shares);
  const x = v({ id: 'x', positionId: 'p' });
  assert.deepEqual(editList(db, x), ['qa']);
  assert.equal(canEditQuotation(x, quotes[0], sharesOf(shares, 'qa')), true);
  const onlyView = v({ id: 'y', positionId: 'p' });
  assert.deepEqual(editList(db, onlyView), []);
  assert.equal(canEditQuotation(onlyView, quotes[0], sharesOf(shares, 'qa')), false);
});

test('người chưa có chức vụ không khớp chia sẻ theo chức vụ; id nhân viên không nhầm với id chức vụ', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'position', target: 'x' }];
  const db = dbWith(shares);
  assert.deepEqual(viewList(db, v({ id: 'u', positionId: null })), []);
  assert.deepEqual(viewList(db, v({ id: 'x', positionId: null })), []); // id 'x' trùng tên chức vụ 'x' nhưng sai loại
  assert.equal(canViewQuotation(v({ id: 'x' }), quotes[0], sharesOf(shares, 'qa')), false);
  assert.equal(canEditQuotation(v({ id: 'x' }), quotes[0], sharesOf(shares, 'qa')), false);
});

test('người bị khoá mất quyền ngay dù đang được chia sẻ', () => {
  const shares: Share[] = [{ quoteId: 'qa', type: 'member', target: 'x' }];
  const db = dbWith(shares);
  const locked = v({ id: 'x', active: false });
  assert.deepEqual(viewList(db, locked), []);
  assert.deepEqual(editList(db, locked), []);
  assert.equal(canViewQuotation(locked, quotes[0], sharesOf(shares, 'qa')), false);
  assert.equal(canEditQuotation(locked, quotes[0], sharesOf(shares, 'qa')), false);
});

test('người phụ trách xem và sửa được (dù không phải chủ), nhưng không chia sẻ / đổi người phụ trách được', () => {
  const qs: Q[] = [{ id: 'q1', creatorId: 'a', assigneeId: 'x' }, { id: 'q2', creatorId: 'a' }];
  const db = dbWith([], qs);
  const x = v({ id: 'x', positionId: 'sale' });
  assert.deepEqual(viewList(db, x), ['q1']);
  assert.deepEqual(editList(db, x), ['q1']);
  assert.equal(canViewQuotation(x, qs[0]), true);
  assert.equal(canEditQuotation(x, qs[0]), true);
  assert.equal(canShareQuotation(x, qs[0]), false);
  assert.equal(canReassignQuotation(x, qs[0]), false);
  assert.equal(canEditQuotation(x, qs[1]), false); // không phụ trách q2
  assert.equal(effectiveAssigneeId(qs[0]!), 'x');
  assert.equal(effectiveAssigneeId(qs[1]!), 'a'); // chưa giao → chủ
  // chủ vẫn xem/sửa/chia sẻ được sau khi giao cho người khác phụ trách
  const a = v({ id: 'a' });
  assert.deepEqual(viewList(db, a), ['q1', 'q2']);
  assert.ok(canEditQuotation(a, qs[0]) && canShareQuotation(a, qs[0]));
});

test('người phụ trách được ưu tiên: đã giao thì chủ không đổi được, manager vẫn đổi được; chưa giao thì chủ giao được', () => {
  const handed: Q = { id: 'q1', creatorId: 'a', assigneeId: 'x' }, notHanded: Q = { id: 'q2', creatorId: 'a', assigneeId: null }, selfAssigned: Q = { id: 'q3', creatorId: 'a', assigneeId: 'a' };
  const owner = v({ id: 'a' }), assignee = v({ id: 'x' }), mgr = v({ id: 'm', role: 'manager' }), other = v({ id: 'z' });
  assert.equal(canReassignQuotation(owner, handed), false);       // đã giao → chủ không đè lên được
  assert.equal(canReassignQuotation(mgr, handed), true);          // manager vẫn đổi được
  assert.equal(canReassignQuotation(assignee, handed), false);    // người phụ trách không tự giao lại
  assert.equal(canReassignQuotation(other, handed), false);
  assert.equal(canReassignQuotation(owner, notHanded), true);     // chưa giao → chủ giao được
  assert.equal(canReassignQuotation(owner, selfAssigned), true);  // assignee = chính chủ cũng là chưa giao
  assert.equal(canReassignQuotation(other, notHanded), false);
  // người đang phụ trách không còn hợp lệ (khoá/NCC) → chủ giao lại được, người khác vẫn không
  assert.equal(canReassignQuotation(owner, handed, false), true);
  assert.equal(canReassignQuotation(other, handed, false), false);
  assert.equal(canReassignQuotation(assignee, handed, false), false);
  // quyền chia sẻ không bị ảnh hưởng: chủ vẫn chia sẻ được sau khi giao
  assert.equal(canShareQuotation(owner, handed), true);
});

test('TÀI KHOẢN NCC không truy cập được báo giá nào – kể cả của chính mình, được giao phụ trách hay được chia sẻ', () => {
  const qs: Q[] = [{ id: 'q1', creatorId: 'n', assigneeId: null }, { id: 'q2', creatorId: 'a', assigneeId: 'n' }, { id: 'q3', creatorId: 'a' }];
  const shares: Share[] = [{ quoteId: 'q3', type: 'member', target: 'n' }, { quoteId: 'q3', type: 'position', target: 'supplier' }];
  const db = dbWith(shares, qs);
  for (const ncc of [v({ id: 'n', role: 'supplier', positionId: 'supplier' }), v({ id: 'n', role: 'supplier' }), v({ id: 'n', role: 'employee', positionId: 'supplier' }), v({ id: 'n', role: 'manager', positionId: 'supplier' })]) {
    assert.deepEqual(viewList(db, ncc), [], JSON.stringify(ncc));
    assert.deepEqual(editList(db, ncc), [], JSON.stringify(ncc));
    for (const q of qs) {
      const sh = sharesOf(shares, q.id);
      assert.ok(!canViewQuotation(ncc, q, sh) && !canEditQuotation(ncc, q, sh) && !canShareQuotation(ncc, q) && !canReassignQuotation(ncc, q), `${ncc.role}/${ncc.positionId} ${q.id}`);
    }
  }
});

test('SQL và hàm thuần luôn cho cùng kết quả xem lẫn sửa (mọi tổ hợp người dùng × báo giá × quyền)', () => {
  const shares: Share[] = [
    { quoteId: 'qa', type: 'member', target: 'x', permission: 'view' }, { quoteId: 'qa', type: 'member', target: 'y', permission: 'edit' },
    { quoteId: 'qb', type: 'position', target: 'p1', permission: 'view' }, { quoteId: 'qc', type: 'position', target: 'p2', permission: 'edit' },
    { quoteId: 'qd', type: 'member', target: 'm' }, { quoteId: 'qd', type: 'position', target: 'p1', permission: 'edit' },
  ];
  const qs: Q[] = [{ id: 'qa', creatorId: 'a', assigneeId: 'u' }, { id: 'qb', creatorId: 'b' }, { id: 'qc', creatorId: 'c', assigneeId: 'y' }, { id: 'qd', creatorId: 'd', assigneeId: 's' }];
  const db = dbWith(shares, qs);
  const viewers = [
    v({ id: 'a', positionId: 'p1' }), v({ id: 's', role: 'employee', positionId: 'supplier' }), v({ id: 'x', positionId: 'p2' }), v({ id: 'y', positionId: null }), v({ id: 'z', positionId: 'p1', active: false }),
    v({ id: 'm', role: 'manager' }), v({ id: 's', role: 'supplier', positionId: 'p2' }), v({ id: 'u', positionId: 'p1' }), v({ id: 'n' }),
  ];
  for (const viewer of viewers) {
    const wantView = qs.filter(q => canViewQuotation(viewer, q, sharesOf(shares, q.id))).map(q => q.id);
    const wantEdit = qs.filter(q => canEditQuotation(viewer, q, sharesOf(shares, q.id))).map(q => q.id);
    assert.deepEqual(viewList(db, viewer), wantView, `xem – ${viewer.id}`);
    assert.deepEqual(editList(db, viewer), wantEdit, `sửa – ${viewer.id}`);
    assert.ok(wantEdit.every(id => wantView.includes(id)), `sửa được thì phải xem được – ${viewer.id}`);
  }
});

test('điều kiện SQL chỉ dùng tham số (không chèn giá trị người dùng vào câu lệnh)', () => {
  const evil = v({ id: "x') OR 1=1 --", positionId: "p'; DROP TABLE staff_quotations; --" });
  for (const s of [quotationScope(evil), quotationEditScope(evil)]) {
    assert.ok(!s.sql.includes('DROP') && !s.sql.includes('OR 1=1'));
    assert.equal(s.bindings.length, 4);
  }
  const db = dbWith();
  assert.deepEqual(viewList(db, evil), []);
});
