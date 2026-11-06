/**
 * TỆP ĐÍNH KÈM BÁO CÁO CHT – khu vực `business`, kho file private (FileStore), chỉ cấp link ký có hạn sau khi kiểm quyền.
 *  GET    /store/reports/files?registerId&kind&period   tệp đã sẵn sàng của một báo cáo + link xem 10 phút (CHT cửa hàng / người duyệt)
 *  POST   /store/reports/files                          CHT tải lên (data URL); kiểm byte thực tế, MIME, nội dung, ≤ 6 MB, số lượng / tổng dung lượng
 *  DELETE /store/reports/files/:id                      CHT gỡ tệp khi báo cáo chưa duyệt
 * Khoá lưu = `store-reports/<uuid>.<đuôi>` do máy chủ đặt – không nhận đường dẫn từ client.
 * Ghi dòng "uploading" trước, tải lên kho file, rồi mới "ready" (chỉ "ready" được cấp link). Lỗi giữa chừng → dọn ngay;
 * không dọn được (mất kết nối, lỗi CSDL) → `sweepStoreFiles` dọn lại ở lượt tải / xoá kế tiếp.
 */
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { FileStore } from '../../../core/storage/file-store.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { storeReportFiles, storeReports } from '../schema.ts';
import { STORE_REPORT_KINDS, isPeriod, periodStarted, type StoreReportKind } from '../domain/reports.ts';
import { PURPOSES_FOR, STORE_FILE_MAX_BYTES, STORE_FILE_PURPOSE_LABEL, checkStoreFile, fileQuota, safeFileName, type StoreFilePurpose } from '../domain/files.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
export interface StoreAccess {
  storeFor(c: Ctx, registerId: unknown): Promise<{ id: string; isManager: boolean }>;
  myStore(db: AnyDb, memberId: string): Promise<{ registerId: string } | null>;
}
const STALE_UPLOAD_MS = 15 * 60_000, SWEEP_BATCH = 20, LINK_SECONDS = 600;
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/;
const nowIso = () => new Date().toISOString();
const kindOf = (v: unknown): StoreReportKind => { if (!STORE_REPORT_KINDS.includes(v as never)) throw new AppError(400, 'Loại báo cáo không hợp lệ.'); return v as StoreReportKind; };
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** Dọn tệp mồ côi: dòng "uploading" quá 15 phút và dòng "deleted" chưa xoá xong ở kho file. Lỗi kho file → để lần sau. */
export async function sweepStoreFiles(db: AnyDb, files: FileStore | undefined, now = nowIso()) {
  if (!files) return 0;
  const before = new Date(Date.parse(now) - STALE_UPLOAD_MS).toISOString();
  const rows = await db.select({ id: storeReportFiles.id, key: storeReportFiles.fileKey, status: storeReportFiles.status }).from(storeReportFiles)
    .where(or(and(eq(storeReportFiles.status, 'uploading'), lt(storeReportFiles.createdAt, before)), and(eq(storeReportFiles.status, 'deleted'), isNull(storeReportFiles.purgedAt))))
    .orderBy(asc(storeReportFiles.createdAt)).limit(SWEEP_BATCH);
  let done = 0;
  for (const r of rows) {
    try { await files.remove([r.key]); } catch { continue; }
    if (r.status === 'uploading') await db.delete(storeReportFiles).where(and(eq(storeReportFiles.id, r.id), eq(storeReportFiles.status, 'uploading')));
    else await db.update(storeReportFiles).set({ purgedAt: now }).where(eq(storeReportFiles.id, r.id));
    done++;
  }
  return done;
}
/** Tệp sẵn sàng của một báo cáo (dùng cho bản chụp lúc nộp). */
export async function readyFiles(db: AnyDb, registerId: string, kind: StoreReportKind, period: string) {
  return db.select({ id: storeReportFiles.id, name: storeReportFiles.name, purpose: storeReportFiles.purpose, mime: storeReportFiles.mime, bytes: storeReportFiles.bytes, sha256: storeReportFiles.sha256, createdAt: storeReportFiles.createdAt })
    .from(storeReportFiles).where(and(eq(storeReportFiles.registerId, registerId), eq(storeReportFiles.kind, kind), eq(storeReportFiles.period, period), eq(storeReportFiles.status, 'ready')))
    .orderBy(asc(storeReportFiles.createdAt), asc(storeReportFiles.id));
}
async function assertEditable(db: AnyDb, registerId: string, kind: StoreReportKind, period: string) {
  const [r] = await db.select({ review: storeReports.review }).from(storeReports).where(and(eq(storeReports.registerId, registerId), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1);
  if (r && r.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt – không thêm / gỡ tệp được.');
}

export function registerStoreFileRoutes(router: Router<StaffEnv>, access: StoreAccess) {
  router.get('/store/reports/files', async c => {
    const q = c.url.searchParams, store = await access.storeFor(c, q.get('registerId')), kind = kindOf(q.get('kind')), period = q.get('period');
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    const rows = await db(c).select({ id: storeReportFiles.id, name: storeReportFiles.name, purpose: storeReportFiles.purpose, mime: storeReportFiles.mime, bytes: storeReportFiles.bytes,
      key: storeReportFiles.fileKey, createdAt: storeReportFiles.createdAt, by: employees.name }).from(storeReportFiles).leftJoin(employees, eq(employees.id, storeReportFiles.createdBy))
      .where(and(eq(storeReportFiles.registerId, store.id), eq(storeReportFiles.kind, kind), eq(storeReportFiles.period, period), eq(storeReportFiles.status, 'ready')))
      .orderBy(asc(storeReportFiles.createdAt), asc(storeReportFiles.id));
    // Link ký chỉ cấp sau khi đã kiểm quyền cửa hàng; chỉ tệp "ready" (đã kiểm tra) mới có link.
    const urls = rows.length && c.env.files ? await c.env.files.signedUrls(rows.map(r => r.key), LINK_SECONDS) : new Map<string, string>();
    return json({ purposes: PURPOSES_FOR[kind].map(p => ({ key: p, label: STORE_FILE_PURPOSE_LABEL[p] })), maxBytes: STORE_FILE_MAX_BYTES,
      files: rows.map(({ key, ...r }) => ({ ...r, url: urls.get(key) ?? null })) });
  }, 'business');

  router.post('/store/reports/files', async c => {
    // ~6 MB dạng base64 + phần JSON.
    const b = await readJson(c.req, 8_500_000), m = (c.state.session as SessionState).member, d = db(c), now = nowIso(), files = c.env.files;
    const kind = kindOf(b.kind), period = b.period, registerId = String(b.registerId ?? '').slice(0, 80);
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    const mine = await access.myStore(d, m.id);
    if (!mine || mine.registerId !== registerId) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được đính kèm tệp.');
    if (!periodStarted(kind, period, now)) throw new AppError(400, 'Kỳ báo cáo chưa bắt đầu.');
    const purpose = b.purpose as StoreFilePurpose;
    if (!PURPOSES_FOR[kind].includes(purpose)) throw new AppError(400, 'Loại tệp không dùng cho báo cáo này.');
    if (!files) throw new AppError(503, 'Chưa cấu hình kho file, tạm thời chưa đính kèm được.');
    const match = typeof b.data === 'string' ? DATA_URL.exec(b.data) : null;
    if (!match) throw new AppError(400, 'Tệp không hợp lệ. Chọn lại tệp rồi thử lại.');
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(match[2]!), ch => ch.charCodeAt(0)); } catch { throw new AppError(400, 'Tệp không hợp lệ. Chọn lại tệp rồi thử lại.'); }
    const check = checkStoreFile(bytes, match[1]!);
    if (!check.ok) throw new AppError(400, check.reason);
    await assertEditable(d, registerId, kind, period);
    await sweepStoreFiles(d, files, now).catch(() => 0);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
    const id = crypto.randomUUID(), fileKey = `store-reports/${id}.${check.ext}`;
    await d.transaction(async tx => {
      // Khoá theo báo cáo: hai lượt tải song song không vượt giới hạn số tệp / dung lượng.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'store-files:' + registerId + ':' + kind + ':' + period}))`);
      const current = await tx.select({ bytes: storeReportFiles.bytes }).from(storeReportFiles)
        .where(and(eq(storeReportFiles.registerId, registerId), eq(storeReportFiles.kind, kind), eq(storeReportFiles.period, period), inArray(storeReportFiles.status, ['uploading', 'ready'])));
      const quota = fileQuota(current, bytes.length);
      if (quota) throw new AppError(409, quota);
      await tx.insert(storeReportFiles).values({ id, registerId, kind, period, purpose, fileKey, name: safeFileName(b.name), mime: check.mime, bytes: bytes.length, sha256, createdBy: m.id, createdAt: now });
    });
    try { await files.put(fileKey, bytes, check.mime); }
    catch {
      await d.delete(storeReportFiles).where(and(eq(storeReportFiles.id, id), eq(storeReportFiles.status, 'uploading'))).catch(() => {});
      await files.remove([fileKey]).catch(() => {});
      throw new AppError(502, 'Tải tệp lên kho file thất bại. Thử lại.');
    }
    try { await d.update(storeReportFiles).set({ status: 'ready' }).where(and(eq(storeReportFiles.id, id), eq(storeReportFiles.status, 'uploading'))); }
    catch (e) { await files.remove([fileKey]).catch(() => {}); throw e; } // dòng "uploading" còn lại → sweep dọn
    return json({ ok: true, id, name: safeFileName(b.name), mime: check.mime, bytes: bytes.length }, 201);
  }, 'business');

  router.delete('/store/reports/files/:id', async c => {
    const m = (c.state.session as SessionState).member, d = db(c), now = nowIso();
    const [f] = await d.select().from(storeReportFiles).where(eq(storeReportFiles.id, String(c.params.id))).limit(1);
    if (!f || f.status !== 'ready') throw new AppError(404, 'Không tìm thấy tệp.');
    const mine = await access.myStore(d, m.id);
    if (!mine || mine.registerId !== f.registerId) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được gỡ tệp.');
    await assertEditable(d, f.registerId, f.kind, f.period);
    await d.update(storeReportFiles).set({ status: 'deleted', deletedBy: m.id, deletedAt: now }).where(and(eq(storeReportFiles.id, f.id), eq(storeReportFiles.status, 'ready')));
    try { await c.env.files?.remove([f.fileKey]); await d.update(storeReportFiles).set({ purgedAt: now }).where(eq(storeReportFiles.id, f.id)); }
    catch { /* kho file lỗi: sweep xoá lại sau */ }
    await sweepStoreFiles(d, c.env.files, now).catch(() => 0);
    return json({ ok: true });
  }, 'business');
}
const db = (c: Ctx) => c.env.db;
