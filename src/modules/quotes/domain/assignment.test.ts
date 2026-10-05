import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignableStaff, planReassignment, planShare, type StaffEntry } from './assignment.ts';
import type { Viewer } from './access.ts';
import { AppError } from '../../../core/errors.ts';

const dir: StaffEntry[] = [
  { id: 'a', name: 'An', role: 'employee', active: true, positionId: 'sale' },
  { id: 'b', name: 'Bình', role: 'employee', active: true, positionId: 'sale' },
  { id: 'c', name: 'Chi', role: 'employee', active: false, positionId: 'sale' },
  { id: 'm', name: 'Mai', role: 'manager', active: true, positionId: 'manager' },
  { id: 'n', name: 'Nam NCC', role: 'supplier', active: true, positionId: 'supplier' },
  { id: 'l', name: 'Lệch', role: 'employee', active: true, positionId: 'supplier' },
  { id: 'd', name: 'Đào', role: 'employee', active: true, positionId: 'accounting' },
];
const V = (id: string, role: Viewer['role'] = 'employee'): Viewer => ({ id, role, active: true, positionId: null });
const quote = { id: 'q', creatorId: 'a', assigneeId: null };
const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof AppError ? e.status : -1; } };

test('danh sách chọn người phụ trách: chỉ nhân viên đang hoạt động, bỏ NCC (cả khi dữ liệu lệch) và người bị khoá, xếp theo tên tiếng Việt', () => {
  assert.deepEqual(assignableStaff(dir).map(m => m.id), ['a', 'b', 'd', 'm']);
});

test('chủ báo giá giao cho nhân viên khác phụ trách: chủ giữ nguyên, kế hoạch ghi assignee + audit', () => {
  const plan = planReassignment(V('a'), quote, 'b', dir);
  assert.deepEqual(plan, { assigneeId: 'b', changed: true, audit: { action: 'quote.reassign', from: 'a', to: 'b' } });
});

test('manager đổi được kể cả khi đã giao; giao lại cho chính chủ thì ghi null (một cách biểu diễn duy nhất)', () => {
  const M = V('m', 'manager');
  assert.equal(planReassignment(M, { ...quote, assigneeId: 'b' }, 'd', dir).assigneeId, 'd');
  const back = planReassignment(M, { ...quote, assigneeId: 'b' }, 'a', dir);
  assert.deepEqual([back.assigneeId, back.changed], [null, true]);
  assert.equal(planReassignment(V('a'), quote, 'a', dir).changed, false); // chưa giao + giao cho chủ = không đổi
  assert.equal(planReassignment(M, { ...quote, assigneeId: 'b' }, 'b', dir).changed, false);
});

test('đã giao cho người khác: chủ, người phụ trách, người xa lạ, người bị khoá, NCC đều không đổi được – chỉ manager', () => {
  const q = { ...quote, assigneeId: 'b' };
  assert.equal(status(() => planReassignment(V('a'), q, 'd', dir)), 403); // chủ cũng không đè lên người phụ trách
  assert.equal(status(() => planReassignment(V('m', 'manager'), q, 'd', dir)), 200);
  assert.equal(status(() => planReassignment(V('b'), q, 'd', dir)), 403); // phụ trách hiện tại cũng không
  assert.equal(status(() => planReassignment(V('d'), q, 'd', dir)), 403);
  assert.equal(status(() => planReassignment({ ...V('a'), active: false }, q, 'd', dir)), 403);
  assert.equal(status(() => planReassignment({ ...V('n', 'supplier'), positionId: 'supplier' }, { ...q, creatorId: 'n' }, 'd', dir)), 403);
  assert.equal(status(() => planReassignment(null, q, 'd', dir)), 403);
});

test('không giao được cho NCC, người bị khoá hoặc id không tồn tại', () => {
  for (const target of ['n', 'l', 'c', 'khong-co', '']) assert.equal(status(() => planReassignment(V('a'), quote, target, dir)), 400, target);
});

test('chia sẻ: kiểm tra người nhận, chức vụ và quyền; mặc định quyền sửa', () => {
  const positions = ['manager', 'sale', 'accounting', 'supplier'];
  assert.deepEqual(planShare(V('a'), quote, { targetType: 'member', targetId: 'b' }, dir, positions), { targetType: 'member', targetId: 'b', permission: 'edit' });
  assert.equal(planShare(V('a'), quote, { targetType: 'position', targetId: 'accounting', permission: 'view' }, dir, positions).permission, 'view');
  assert.equal(planShare(V('m', 'manager'), quote, { targetType: 'member', targetId: 'd' }, dir, positions).targetId, 'd');
});

test('chia sẻ bị từ chối: sai người, NCC, chính chủ, chức vụ lạ/NCC, quyền lạ, loại lạ', () => {
  const positions = ['manager', 'sale', 'accounting', 'supplier'];
  const share = (input: object, viewer = V('a')) => status(() => planShare(viewer, quote, input as never, dir, positions));
  assert.equal(share({ targetType: 'member', targetId: 'b' }, V('b')), 403); // người nhận chia sẻ không chia sẻ tiếp
  assert.equal(share({ targetType: 'member', targetId: 'n' }), 400);
  assert.equal(share({ targetType: 'member', targetId: 'l' }), 400);
  assert.equal(share({ targetType: 'member', targetId: 'c' }), 400);
  assert.equal(share({ targetType: 'member', targetId: 'a' }), 400);
  assert.equal(share({ targetType: 'position', targetId: 'supplier' }), 400);
  assert.equal(share({ targetType: 'position', targetId: 'khong-co' }), 400);
  assert.equal(share({ targetType: 'member', targetId: 'b', permission: 'owner' }), 400);
  assert.equal(share({ targetType: 'group', targetId: 'b' }), 400);
});

test('chống bế tắc: người đang phụ trách bị khoá / chuyển sang NCC thì chủ giao lại được, người khác thì không', () => {
  for (const gone of ['c', 'n', 'l']) { // c = bị khoá, n = NCC, l = chức vụ NCC (vai trò lệch)
    const q = { ...quote, assigneeId: gone };
    assert.equal(planReassignment(V('a'), q, 'b', dir).assigneeId, 'b', gone);
    assert.equal(status(() => planReassignment(V('d'), q, 'b', dir)), 403, gone);
    assert.equal(status(() => planReassignment(V(gone), q, 'b', dir)), 403, gone);
  }
  // người phụ trách còn hợp lệ → chủ vẫn không đè được
  assert.equal(status(() => planReassignment(V('a'), { ...quote, assigneeId: 'd' }, 'b', dir)), 403);
});

test('thông báo lỗi nói rõ lý do khi báo giá đã giao cho người khác', () => {
  try { planReassignment(V('a'), { ...quote, assigneeId: 'b' }, 'd', dir); assert.fail('phải ném lỗi'); }
  catch (e) { assert.match((e as AppError).message, /đã giao cho người khác phụ trách; chỉ Manager/); }
});
