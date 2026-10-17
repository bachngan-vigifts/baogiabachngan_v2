import { count, desc, eq, lt, max } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { newToken, sha256Hex } from '../../staff/domain/session.ts';
import { synctimeConnections, synctimeReceipts } from '../schema.ts';

export const SYNCTIME_PATH = '/integrations/synctime/webhook';
export async function readWebhook(req: Request): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw new AppError(415, 'Webhook cần gửi JSON.');
  const reader = req.body?.getReader(); if (!reader) throw new AppError(400, 'Thiếu nội dung webhook.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > 131072) { await reader.cancel(); throw new AppError(413, 'Gói webhook quá lớn (tối đa 128 KiB).'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error();
    return text; // Giữ nguyên JSON nguồn, kể cả mã log vượt độ chính xác Number. Không lưu header.
  } catch { throw new AppError(400, 'JSON webhook không hợp lệ.'); }
}

export function registerSynctimeRoutes(router: Router<StaffEnv>) {
  router.post(SYNCTIME_PATH, async c => {
    const payload = await readWebhook(c.req), id = sha256Hex(payload), receivedAt = new Date().toISOString();
    const duplicate = await c.env.db.transaction(async tx => {
      await tx.delete(synctimeReceipts).where(lt(synctimeReceipts.receivedAt, new Date(Date.now() - 30 * 864e5).toISOString()));
      const inserted = await tx.insert(synctimeReceipts).values({ id, payload, receivedAt }).onConflictDoNothing().returning({ id: synctimeReceipts.id });
      return !inserted.length;
    });
    // ACK chỉ sau khi lưu bền vững. Chưa suy đoán trường dữ liệu và chưa cập nhật chấm công.
    return json({ status: 'success', received: true, duplicate, id, processing: 'pending_schema_review' });
  }, 'synctime-sync');

  router.get('/hr/synctime', async c => {
    const [connection] = await c.env.db.select({ updatedAt: synctimeConnections.updatedAt }).from(synctimeConnections).where(eq(synctimeConnections.id, 'synctime'));
    const [summary] = await c.env.db.select({ total: count(), latestAt: max(synctimeReceipts.receivedAt) }).from(synctimeReceipts);
    const latest = await c.env.db.select({ id: synctimeReceipts.id, receivedAt: synctimeReceipts.receivedAt }).from(synctimeReceipts).orderBy(desc(synctimeReceipts.receivedAt)).limit(10);
    return json({ configured: !!connection, updatedAt: connection?.updatedAt ?? null, total: summary!.total, latestAt: summary!.latestAt,
      path: SYNCTIME_PATH, latest, processing: 'pending_schema_review' });
  }, 'admin');

  router.post('/hr/synctime/key', async c => {
    const b = await readJson(c.req, 1000);
    const [old] = await c.env.db.select().from(synctimeConnections).where(eq(synctimeConnections.id, 'synctime')).limit(1);
    if (old && b.replace !== true) throw new AppError(409, 'Đã có mã kết nối. Chỉ đổi mã khi cần thay cấu hình bên SyncTime.');
    const secret = 'stwh_' + newToken(), row = { id: 'synctime', tokenHash: sha256Hex(secret), updatedAt: new Date().toISOString() };
    if (b.replace === true) await c.env.db.insert(synctimeConnections).values(row).onConflictDoUpdate({ target: synctimeConnections.id, set: row });
    else {
      const made = await c.env.db.insert(synctimeConnections).values(row).onConflictDoNothing().returning({ id: synctimeConnections.id });
      if (!made.length) throw new AppError(409, 'Một phiên khác đã tạo mã. Tải lại trạng thái kết nối.');
    }
    // Chỉ trả một lần cho Manager vừa bấm tạo. DB lưu hash; mã không xuất hiện ở GET hoặc nhật ký.
    return json({ header: 'Authorization: Bearer ' + secret });
  }, 'admin');

  router.delete('/hr/synctime/key', async c => {
    await c.env.db.delete(synctimeConnections).where(eq(synctimeConnections.id, 'synctime'));
    return json({ ok: true });
  }, 'admin');

  router.get('/hr/synctime/receipts/:id', async c => {
    if (!/^[a-f0-9]{64}$/.test(c.params.id || '')) throw new AppError(400, 'Mã gói không hợp lệ.');
    const [r] = await c.env.db.select().from(synctimeReceipts).where(eq(synctimeReceipts.id, c.params.id!)).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy gói webhook.');
    return json({ id: r.id, receivedAt: r.receivedAt, payloadText: r.payload });
  }, 'admin');
}
