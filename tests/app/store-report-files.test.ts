import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { posRegisters } from '../../src/modules/sales/pos-schema.ts';
import { storeReportFiles, storeReports } from '../../src/modules/store/schema.ts';
import { checkStoreFile, fileQuota, safeFileName, STORE_FILE_MAX_BYTES } from '../../src/modules/store/domain/files.ts';
import { sweepStoreFiles } from '../../src/modules/store/api/file-routes.ts';
import { vnClock } from '../../src/modules/store/domain/reports.ts';

/** Tệp đính kèm báo cáo CHT: kiểm tra byte / loại / nội dung / dung lượng, phạm vi cửa hàng, dọn tệp khi lỗi, khoá khi đã duyệt. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Catalog ${body} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const dataUrl = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;

test('domain: nhận dạng theo byte thực tế, MIME phải khớp, PDF không có nội dung chủ động, giới hạn dung lượng', () => {
  assert.deepEqual(checkStoreFile(PNG, 'image/png'), { ok: true, mime: 'image/png', ext: 'png' });
  assert.equal(checkStoreFile(PNG, 'image/jpeg').ok, false, 'khai JPEG nhưng là PNG');
  assert.equal(checkStoreFile(new TextEncoder().encode('MZ\x90\x00 exe'), 'image/png').ok, false, 'tệp chạy giả ảnh');
  assert.equal(checkStoreFile(new TextEncoder().encode('<svg onload=alert(1)>'), 'image/svg+xml').ok, false);
  assert.equal(checkStoreFile(pdf(''), 'application/pdf').ok, true);
  assert.equal(checkStoreFile(pdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf').ok, false);
  assert.equal(checkStoreFile(new TextEncoder().encode('%PDF-1.4 cut'), 'application/pdf').ok, false, 'PDF cụt');
  assert.equal(checkStoreFile(new Uint8Array(0), 'image/png').ok, false);
  const big = new Uint8Array(STORE_FILE_MAX_BYTES + 1); big.set(PNG);
  assert.equal(checkStoreFile(big, 'image/png').ok, false);
  assert.match(fileQuota(Array.from({ length: 6 }, () => ({ bytes: 1 })), 1)!, /Tối đa 6/);
  assert.match(fileQuota([{ bytes: 20 * 1024 * 1024 }], 5 * 1024 * 1024)!, /24 MB/);
  assert.equal(safeFileName('../../etc/passwd'), '.. .. etc passwd');
});

async function store() {
  const f = await setup();
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: f.registerId, memberId: 'emp' }));
  const [reg] = await f.db.select().from(posRegisters).where(eq(posRegisters.id, f.registerId));
  await f.db.insert(posRegisters).values({ ...reg!, id: 'other-store', name: 'Cửa hàng khác' });
  ok(await f.call('/store/managers', f.mgr, 'PUT', { registerId: 'other-store', memberId: 'cashier2' }));
  const day = vnClock(new Date().toISOString()).day;
  const upload = (extra: Record<string, unknown> = {}, cookie = f.emp) => f.call('/store/reports/files', cookie, 'POST',
    { registerId: f.registerId, kind: 'daily', period: day, purpose: 'bank_deposit', name: 'bien-lai.png', data: dataUrl('image/png', PNG), ...extra });
  const list = (cookie = f.emp, registerId = f.registerId) => f.call(`/store/reports/files?registerId=${registerId}&kind=daily&period=${day}`, cookie);
  return { ...f, day, upload, list };
}

test('tải lên / xem / gỡ: chỉ CHT cửa hàng, link ký sau kiểm quyền, khoá lưu do máy chủ đặt, tệp giả bị từ chối', async () => {
  const f = await store();
  const made = ok(await f.upload({ name: '../../x.png', fileKey: 'evil/path.png' }), 201);
  const [row] = await f.db.select().from(storeReportFiles);
  assert.equal(row!.status, 'ready'); assert.match(row!.fileKey, /^store-reports\/[0-9a-f-]{36}\.png$/, 'không nhận đường dẫn client');
  assert.equal(row!.sha256.length, 64); assert.ok(f.files.files.has(row!.fileKey));
  const mine = ok(await f.list());
  assert.equal(mine.files.length, 1); assert.match(mine.files[0].url, /^data:image\/png;base64,/); assert.equal(mine.files[0].id, made.id);
  assert.equal(ok(await f.list(f.mgr)).files.length, 1, 'người duyệt xem được');
  assert.equal((await f.list(f.other)).status, 403, 'CHT cửa hàng khác không xem');
  assert.equal((await f.upload({}, f.other)).status, 403, 'CHT cửa hàng khác không tải vào cửa hàng này');
  assert.equal((await f.call('/store/reports/files/' + made.id, f.other, 'DELETE')).status, 403);
  assert.equal((await f.call('/store/reports/files/' + made.id, f.mgr, 'DELETE')).status, 403, 'người duyệt không gỡ tệp của CHT');
  // Tệp giả / quá lớn / sai mục đích.
  assert.equal((await f.upload({ data: dataUrl('image/png', new TextEncoder().encode('MZ fake exe')) })).status, 400);
  assert.equal((await f.upload({ data: dataUrl('application/pdf', pdf('/JS (x)')) })).status, 400);
  const big = new Uint8Array(STORE_FILE_MAX_BYTES + 10); big.set(PNG);
  assert.equal((await f.upload({ data: dataUrl('image/png', big) })).status, 400);
  assert.equal((await f.upload({ purpose: 'stocktake_record' })).status, 400, 'biên bản kiểm kê không gắn vào báo cáo ngày');
  assert.equal((await f.upload({ data: 'https://evil.test/a.png' })).status, 400);
  assert.equal((await f.db.select().from(storeReportFiles)).length, 1, 'tệp bị từ chối không ghi dòng');
  // Gỡ: xoá ở kho file, không còn link.
  ok(await f.call('/store/reports/files/' + made.id, f.emp, 'DELETE'));
  assert.equal(f.files.files.size, 0); assert.equal(ok(await f.list()).files.length, 0);
  const [gone] = await f.db.select().from(storeReportFiles);
  assert.equal(gone!.status, 'deleted'); assert.ok(gone!.purgedAt);
});

test('giới hạn số tệp; lỗi kho file không để lại dòng / tệp; tệp mồ côi được dọn lại', async () => {
  const f = await store();
  for (let i = 0; i < 6; i++) ok(await f.upload({ name: `t${i}.png` }), 201);
  const full = await f.upload();
  assert.equal(full.status, 409); assert.match(full.data.error, /Tối đa 6/);
  // Kho file lỗi khi tải: không còn dòng "uploading", không có tệp.
  await f.db.delete(storeReportFiles);
  f.files.files.clear();
  const put = f.files.put;
  f.files.put = async (key, bytes, mime) => { await put.call(f.files, key, bytes, mime); throw new Error('mất kết nối'); };
  assert.equal((await f.upload()).status, 502);
  assert.equal((await f.db.select().from(storeReportFiles)).length, 0); assert.equal(f.files.files.size, 0, 'tệp tải dở bị xoá');
  f.files.put = put;
  // Dòng "uploading" quá hạn (lỗi CSDL sau khi tải) và dòng đã gỡ chưa xoá được ở kho file → sweep dọn.
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  await f.files.put('store-reports/stale.png', PNG, 'image/png');
  await f.files.put('store-reports/removed.png', PNG, 'image/png');
  const base = { registerId: f.registerId, kind: 'daily' as const, period: f.day, purpose: 'other' as const, name: 'x', mime: 'image/png', bytes: PNG.length, sha256: 'x'.repeat(64), createdBy: 'emp' };
  await f.db.insert(storeReportFiles).values([{ ...base, id: 'stale', fileKey: 'store-reports/stale.png', status: 'uploading', createdAt: old },
    { ...base, id: 'removed', fileKey: 'store-reports/removed.png', status: 'deleted', createdAt: old, deletedAt: old }]);
  assert.equal(ok(await f.list()).files.length, 0, 'tệp chưa sẵn sàng không có link');
  const remove = f.files.remove;
  f.files.remove = async () => { throw new Error('kho file lỗi'); };
  assert.equal(await sweepStoreFiles(f.db, f.files), 0, 'kho file lỗi: để lần sau');
  f.files.remove = remove;
  assert.equal(await sweepStoreFiles(f.db, f.files), 2);
  assert.equal(f.files.files.size, 0);
  const rows = await f.db.select().from(storeReportFiles);
  assert.deepEqual(rows.map(r => [r.id, r.status, !!r.purgedAt]), [['removed', 'deleted', true]]);
});

test('nộp chính thức ghi danh sách tệp vào bản chụp; đã duyệt thì không thêm / gỡ tệp', async () => {
  const f = await store();
  const file = ok(await f.upload(), 201);
  const rep = ok(await f.call('/store/reports', f.emp, 'POST', { registerId: f.registerId, kind: 'daily', period: f.day, clientKey: crypto.randomUUID(), inputs: { bankDeposit: 0 } }), 201);
  const [saved] = await f.db.select().from(storeReports);
  assert.deepEqual(JSON.parse(saved!.data).meta.files.map((x: any) => [x.id, x.purpose]), [[file.id, 'bank_deposit']]);
  ok(await f.call(`/store/reports/${rep.id}/review`, f.mgr, 'POST', { review: 'ok' }));
  assert.equal((await f.upload()).status, 409);
  assert.equal((await f.call('/store/reports/files/' + file.id, f.emp, 'DELETE')).status, 409);
  assert.equal(ok(await f.list(f.mgr)).files.length, 1);
});
