import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockBalances, stockMoves, stockTransferLines, stockTransfers, warehouseSellers } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { webNotifications } from '../../src/modules/notifications/schema.ts';

/**
 * Điều chuyển kho 2 bước: kho đi "Đã chuyển" (trừ kho đi, Đang chuyển) → kho đến "Nhận hàng" + SL thực nhận TỪNG mã;
 * phần thiếu giữ chênh lệch chờ đối soát, nhận thiếu bắt buộc lý do và báo Manager.
 */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
const migration = readFileSync(new URL('../../migrations/postgres/20261102120000_transfer_receive.sql', import.meta.url), 'utf8');
async function setup() {
  const { db, d1, client } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  for (const [id, pos] of [['ketoan', 'accounting'], ['kho', 'warehouse'], ['ml', 'sales-ml']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, pw);
  }
  const router = createAppRouter();
  const env = { db, passwordIterations: 1000 } as never;
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), env)).headers.get('set-cookie')!.split(';')[0]!;
  await db.insert(warehouses).values([{ id: 'vig', name: 'KHO VIGIFTS', kind: 'stock' }, { id: 'ml', name: 'SR Minh Long - Lock', kind: 'stock' }]);
  await db.insert(warehouseSellers).values([{ warehouseId: 'vig', positionId: 'sale-admin' }, { warehouseId: 'ml', positionId: 'sales-ml' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }, { sku: 'DIA2', name: 'Đĩa sứ', unit: 'cái', updatedAt: now }]);
  await postMoves(db as never, 'mgr', [
    { sku: 'LY1', warehouseId: 'vig', qty: 50, kind: 'opening', refType: 'opening', refId: 'op1' }, { sku: 'LY1', warehouseId: 'ml', qty: 20, kind: 'opening', refType: 'opening', refId: 'op1' },
    { sku: 'DIA2', warehouseId: 'vig', qty: 40, kind: 'opening', refType: 'opening', refId: 'op1' }, { sku: 'DIA2', warehouseId: 'ml', qty: 0.001, kind: 'opening', refType: 'opening', refId: 'op1' }]);
  const s = { db, client, call, mgr: await login('mgr@x.vn'), kt: await login('ketoan@x.vn'), kho: await login('kho@x.vn'), ml: await login('ml@x.vn') };
  const bal = async (sku: string, wh: string) => (await db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.sku, sku), eq(stockBalances.warehouseId, wh))))[0]?.qty ?? 0;
  /** NVBH Minh Long xin 30 ly + 10 đĩa từ KHO VIGIFTS → Manager duyệt → Kho bấm "Đã chuyển" (đang chuyển). */
  const shipped = async () => {
    const t = await call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Khách lẻ cần hàng', lines: [{ sku: 'LY1', qty: 30 }, { sku: 'DIA2', qty: 10 }] });
    assert.equal(t.status, 201, JSON.stringify(t.data));
    assert.equal((await call(`/stock-transfers/${t.data.id}/approve`, s.mgr, 'POST', {})).status, 200);
    const sh = await call(`/stock-transfers/${t.data.id}/ship`, s.kho, 'POST', {});
    assert.equal(sh.status, 200, JSON.stringify(sh.data));
    return sh.data;
  };
  return { ...s, bal, shipped };
}

test('nhận hàng điều chuyển: nhập SL từng mã; nhận thiếu giữ chênh lệch chờ đối soát, bắt buộc lý do, báo Manager', async () => {
  const s = await setup(), t = await s.shipped();
  assert.equal(t.status, 'shipped');assert.equal(t.actions.ship, false);assert.equal(t.actions.receive, false, 'kho xuất không mặc nhiên được nhận');
  assert.equal((await s.call(`/stock-transfers/${t.id}`,s.ml)).data.actions.receive,true);
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml'), await s.bal('DIA2', 'vig'), await s.bal('DIA2', 'ml')], [20, 20, 30, 0.001], 'đang chuyển: chỉ trừ kho đi');
  const body = (qtyLy: number, qtyDia: number, note?: string) => ({ revision: t.revision, lines: [{ sku: 'LY1', qty: qtyLy }, { sku: 'DIA2', qty: qtyDia }], ...(note === undefined ? {} : { note }) });
  const noWhy = await s.call(`/stock-transfers/${t.id}/receive`, s.ml, 'POST', body(22, 10));
  assert.equal(noWhy.status, 400);assert.equal(noWhy.data.code, 'RECEIVE_NOTE_REQUIRED');
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml')], [20, 20], 'bị chặn: không ghi sổ');
  const got = await s.call(`/stock-transfers/${t.id}/receive`, s.ml, 'POST', body(22, 10, 'Giao thiếu 8 ly, vỡ 0'));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.status, 'done');assert.equal(got.data.doneNote, 'Giao thiếu 8 ly, vỡ 0');
  assert.deepEqual(got.data.lines.map((l: any) => [l.sku, l.qty, l.receivedQty]), [['DIA2', 10, 10], ['LY1', 30, 22]]);
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml')], [20, 42], 'cộng kho đến đúng số nhận; 8 ly thiếu chưa hoàn kho đi');
  assert.deepEqual([await s.bal('DIA2', 'vig'), await s.bal('DIA2', 'ml')], [30, 10.001]);
  assert.equal(await s.bal('LY1', 'vig') + await s.bal('LY1', 'ml'), 62, '8 ly đang chờ đối soát, không tự đưa vào tồn bán');
  const moves = (await s.db.select().from(stockMoves).where(and(eq(stockMoves.refType, 'stock_transfer'), eq(stockMoves.refId, t.id)))).map(m => [m.sku, m.warehouseId, m.kind, m.qty].join('|')).sort();
  assert.deepEqual(moves, ['DIA2|ml|transfer_in|10', 'DIA2|vig|transfer_out|-10', 'LY1|ml|transfer_in|22', 'LY1|vig|transfer_out|-30']);
  assert.equal((await s.call(`/stock-transfers/${t.id}/receive`, s.ml, 'POST', body(22, 10, 'lần hai'))).status, 409, 'nhận một lần, replay không cộng thêm');
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml')], [20, 42]);
  const notes = await s.db.select().from(webNotifications).where(eq(webNotifications.eventType, 'transfer_short'));
  assert.ok(notes.some(n => n.targetMemberId === 'mgr' && n.body.includes('LY1 thiếu 8')), 'Manager được báo nhận thiếu: ' + JSON.stringify(notes.map(n => n.body)));
  const history = (await s.call('/stock-moves?group=reverse', s.mgr)).data.moves.filter((m: any) => m.refNo === t.transferNo);
  assert.equal(history.length, 0, 'không tự tạo dòng hoàn kho cho hàng chưa thực nhận');
});

test('nhận hàng: bắt buộc nhập từng mã, 0 ≤ nhận ≤ chuyển; sai dữ liệu không ghi sổ', async () => {
  const s = await setup(), t = await s.shipped(), url = `/stock-transfers/${t.id}/receive`;
  const bad = async (lines: unknown, code?: string) => { const r = await s.call(url, s.ml, 'POST', { revision: t.revision, note: 'ghi chú', lines }); assert.equal(r.status, 400, JSON.stringify(r.data)); if (code) assert.equal(r.data.code, code); };
  await bad([{ sku: 'LY1', qty: 30 }], 'RECEIVE_LINES_REQUIRED');
  await bad(undefined, 'RECEIVE_LINES_REQUIRED');
  await bad([{ sku: 'LY1', qty: 31 }, { sku: 'DIA2', qty: 10 }], 'RECEIVE_OVER');
  await bad([{ sku: 'LY1', qty: -1 }, { sku: 'DIA2', qty: 10 }]);
  await bad([{ sku: 'LY1', qty: '' }, { sku: 'DIA2', qty: 10 }]);
  await bad([{ sku: 'LY1', qty: 'abc' }, { sku: 'DIA2', qty: 10 }]);
  for(const qty of [-0.0004, true, false, [], {}, '30', 29.0004, 0.0001]) await bad([{sku:'LY1',qty},{sku:'DIA2',qty:10}]);
  await bad([{sku:'LY1',qty:30.0004},{sku:'DIA2',qty:10}], 'RECEIVE_OVER');
  await bad([{ sku: 'LY1', qty: 30 }, { sku: 'LY1', qty: 30 }, { sku: 'DIA2', qty: 10 }]);
  await bad([{ sku: 'LY1', qty: 30 }, { sku: 'DIA2', qty: 10 }, { sku: 'KHONG-CO', qty: 1 }]);
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml')], [20, 20]);
  assert.equal((await s.db.select().from(stockTransfers).where(eq(stockTransfers.id, t.id)))[0]!.status, 'shipped');
  assert.ok((await s.db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id))).every(l => l.receivedQty === null));
  const stale = await s.call(url, s.ml, 'POST', { revision: t.revision - 1, lines: [{ sku: 'LY1', qty: 30 }, { sku: 'DIA2', qty: 10 }] });
  assert.equal(stale.status, 409);assert.equal(stale.data.code, 'TRANSFER_CHANGED');
});

test('nhận hàng: ai được nhận; chưa xuất thì chưa nhận được; nhận 0 giữ toàn bộ chênh lệch chờ đối soát', async () => {
  const s = await setup();
  const made = await s.call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Khách lẻ cần hàng', lines: [{ sku: 'LY1', qty: 5 }] });
  const id = made.data.id as string, lines = [{ sku: 'LY1', qty: 5 }];
  assert.equal((await s.call(`/stock-transfers/${id}/receive`, s.kho, 'POST', { lines })).status, 409, 'chưa duyệt / chưa xuất');
  await s.call(`/stock-transfers/${id}/approve`, s.mgr, 'POST', {});
  assert.equal((await s.call(`/stock-transfers/${id}/receive`, s.kho, 'POST', { lines })).status, 409, 'đã duyệt nhưng kho đi chưa chuyển');
  assert.equal((await s.call(`/stock-transfers/${id}/ship`, s.ml, 'POST', {})).status, 403, 'kho đến không tự bấm xuất thay kho đi');
  assert.equal((await s.call(`/stock-transfers/${id}/ship`, s.kho, 'POST', {})).status, 200);
  assert.equal((await s.call(`/stock-transfers/${id}`, s.kt)).data.actions.receive, false);
  assert.equal((await s.call(`/stock-transfers/${id}/receive`, s.kt, 'POST', { lines })).status, 403, 'Kế toán chưa được phân kho đến');
  assert.equal((await s.call(`/stock-transfers/${id}/cancel`, s.mgr, 'POST', {})).status, 409, 'đang chuyển: không huỷ phiếu');
  assert.equal((await s.call(`/stock-transfers/${id}/receive`, s.kho, 'POST', {lines})).status,403,'quyền điều chuyển chung không cấp quyền nhận');
  const zero = await s.call(`/stock-transfers/${id}/receive`, s.ml, 'POST', { lines: [{ sku: 'LY1', qty: 0 }], note: 'Xe chưa tới, hàng chưa ra khỏi cửa' });
  assert.equal(zero.status, 200, JSON.stringify(zero.data));assert.equal(zero.data.status, 'done');
  assert.deepEqual([await s.bal('LY1', 'vig'), await s.bal('LY1', 'ml')], [45, 20], 'nhận 0: không tự cộng lại kho đi, kho đến không đổi');
  assert.equal(zero.data.lines[0].receivedQty, 0);
});

test('phiếu cũ đã chuyển một bước (received_qty trống) hiển thị như nhận đủ; migration chạy lại an toàn và chặn dữ liệu sai', async () => {
  const s = await setup();
  await s.db.insert(stockTransfers).values({ id: 'old', transferNo: 'PCK-OLD', fromWarehouseId: 'vig', toWarehouseId: 'ml', status: 'done', reason: 'Phiếu cũ', requestedBy: 'ml', doneBy: 'kho', doneAt: now, createdAt: now, updatedAt: now });
  await s.db.insert(stockTransferLines).values({ id: 'old-1', transferId: 'old', sku: 'LY1', name: 'Ly sứ', unit: 'cái', qty: 4 });
  const view = (await s.call('/stock-transfers/old', s.mgr)).data;
  assert.equal(view.status, 'done');assert.equal(view.lines[0].receivedQty, 4);assert.equal(view.shippedByName, '');
  await s.client.exec(migration);await s.client.exec(migration);
  assert.equal((await s.call('/stock-transfers/old', s.mgr)).data.lines[0].receivedQty, 4);
  await assert.rejects(s.client.exec("update stock_transfer_lines set received_qty = 5 where id = 'old-1'"), /chk_stock_transfer_lines_received/);
  await assert.rejects(s.client.exec("update stock_transfer_lines set received_qty = -1 where id = 'old-1'"), /chk_stock_transfer_lines_received/);
  await assert.rejects(s.client.exec("update stock_transfers set status = 'lost' where id = 'old'"), /chk_stock_transfers_status/);
  await s.client.exec("update stock_transfers set status = 'shipped' where id = 'old'");
});


test('receipt belongs to destination staff or Manager, not the requester or global move permission; fractional receipt stays atomic', async()=>{
  const s=await setup();
  const create=async()=>{const made=await s.call('/stock-transfers',s.kt,'POST',{fromWarehouseId:'vig',toWarehouseId:'ml',reason:'Xin hàng cho kho đích',lines:[{sku:'LY1',qty:2}]});assert.equal(made.status,201);const id=made.data.id;assert.equal((await s.call(`/stock-transfers/${id}/approve`,s.mgr,'POST',{})).status,200);const shipped=await s.call(`/stock-transfers/${id}/ship`,s.kho,'POST',{});assert.equal(shipped.status,200);return shipped.data;};
  const t=await create(),url=`/stock-transfers/${t.id}/receive`,body={revision:t.revision,note:'Nhận thiếu chờ đối soát',lines:[{sku:'LY1',qty:1.001}]};
  for(const actor of [s.kt,s.kho]){assert.equal((await s.call(`/stock-transfers/${t.id}`,actor)).data.actions.receive,false);assert.equal((await s.call(url,actor,'POST',body)).status,403);}
  const jobs=await s.db.select().from(tasks).where(eq(tasks.sourceId,t.id));
  assert.deepEqual(jobs.filter(j=>j.autoKey?.startsWith('transfer-receive:')).map(j=>j.assigneeId),['ml']);
  const notices=await s.db.select().from(webNotifications).where(eq(webNotifications.eventType,'transfer_shipped'));
  assert.ok(notices.some(n=>n.targetMemberId==='ml'));assert.ok(notices.some(n=>n.targetMemberId==='mgr'));
  assert.ok(!notices.some(n=>n.targetMemberId==='ketoan'||n.targetMemberId==='kho'));
  assert.equal((await s.call(url,s.ml,'POST',body)).status,200);
  assert.equal((await s.call(url,s.ml,'POST',body)).status,409);
  assert.equal((await s.db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,t.id)))[0]!.receivedQty,1.001);
  await s.db.delete(warehouseSellers).where(eq(warehouseSellers.warehouseId,'ml'));
  const next=await create();
  const fallback=await s.db.select().from(tasks).where(eq(tasks.autoKey,`transfer-receive:${next.id}`));
  assert.equal(fallback.length,1);assert.equal(fallback[0]!.assigneeId,null);assert.equal(fallback[0]!.assigneePosition,null,'chưa phân kho: giao Manager, không giao nhóm Kho chung');
  assert.equal((await s.call(`/stock-transfers/${next.id}/receive`,s.mgr,'POST',{revision:next.revision,lines:[{sku:'LY1',qty:2}]})).status,200,'Manager nhận thay không cần được phân kho');
});

test('Manager "Tạo & xuất": một lần bấm tạo + duyệt + trừ kho đi; lỗi xuất thì không tạo phiếu; bấm lại không trừ trùng', async () => {
  const s = await setup(), body = { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Bổ sung cửa hàng', lines: [{ sku: 'LY1', qty: 5 }] };
  const key = crypto.randomUUID(), r = await s.call('/stock-transfers', s.mgr, 'POST', { ...body, clientKey: key, mode: 'ship' });
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.status, 'shipped'); assert.ok(r.data.approvedByName); assert.ok(r.data.shippedByName);
  assert.equal(await s.bal('LY1', 'vig'), 45); assert.equal(await s.bal('LY1', 'ml'), 20, 'chưa cộng kho đến tới khi nhận');
  const again = await s.call('/stock-transfers', s.mgr, 'POST', { ...body, clientKey: key, mode: 'ship' });
  assert.equal(again.data.replayed, true); assert.equal(await s.bal('LY1', 'vig'), 45, 'bấm lại không trừ trùng');
  assert.equal((await s.db.select().from(stockMoves).where(eq(stockMoves.refId, r.data.id))).length, 1);
  const got = await s.call(`/stock-transfers/${r.data.id}/receive`, s.ml, 'POST', { revision: r.data.revision, lines: [{ sku: 'LY1', qty: 5 }] });
  assert.equal(got.status, 200, JSON.stringify(got.data)); assert.equal(await s.bal('LY1', 'ml'), 25);
});
test('Manager "Tạo & duyệt" chỉ duyệt, chưa trừ kho; nhân viên không dùng được chế độ nhanh; thiếu tồn thì không tạo phiếu', async () => {
  const s = await setup(), body = { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Bổ sung', lines: [{ sku: 'LY1', qty: 5 }] };
  const a = await s.call('/stock-transfers', s.mgr, 'POST', { ...body, mode: 'approve' });
  assert.equal(a.status, 201); assert.equal(a.data.status, 'approved'); assert.equal(await s.bal('LY1', 'vig'), 50);
  assert.equal((await s.call('/stock-transfers', s.ml, 'POST', { ...body, mode: 'ship' })).status, 403);
  const before = (await s.db.select().from(stockTransfers)).length;
  const short = await s.call('/stock-transfers', s.mgr, 'POST', { ...body, lines: [{ sku: 'LY1', qty: 999 }], mode: 'ship' });
  assert.equal(short.status, 409); assert.equal(short.data.code, 'TRANSFER_SHORT');
  assert.equal((await s.db.select().from(stockTransfers)).length, before, 'xuất lỗi thì không còn phiếu dở'); assert.equal(await s.bal('LY1', 'vig'), 50);
  const plain = await s.call('/stock-transfers', s.ml, 'POST', body); assert.equal(plain.status, 201); assert.equal(plain.data.status, 'pending', 'mặc định vẫn chờ duyệt');
});

test('clientKey giữ chế độ tạo ban đầu, không đổi approve sang ship dù phiếu đã đi tiếp',async()=>{
 const s=await setup(),clientKey=crypto.randomUUID(),body={clientKey,fromWarehouseId:'vig',toWarehouseId:'ml',reason:'Tái gửi sau mất mạng',lines:[{sku:'LY1',qty:3}],mode:'approve'};
 const first=await s.call('/stock-transfers',s.mgr,'POST',body);assert.equal(first.status,201);
 const conflict=await s.call('/stock-transfers',s.mgr,'POST',{...body,mode:'ship'});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await s.call(`/stock-transfers/${first.data.id}/ship`,s.mgr,'POST',{})).status,200);
 const replay=await s.call('/stock-transfers',s.mgr,'POST',body);assert.equal(replay.status,200);assert.equal(replay.data.status,'shipped');
 assert.equal((await s.call('/stock-transfers',s.mgr,'POST',{...body,mode:'ship'})).status,409,'chế độ gốc không được suy từ trạng thái hiện tại');
});
