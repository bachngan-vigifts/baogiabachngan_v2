import { and, asc, eq } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { warehouseImageJobs as jobs, warehouseImageQueueState as queue } from '../warehouse-image-job-schema.ts';

const queueId = 'warehouse-image-v1';
const nowIso = () => new Date().toISOString();
const allowedImage = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const view = (j: typeof jobs.$inferSelect) => ({
  jobId: j.id, status: j.status, position: j.positionHint, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  result: j.status === 'completed' ? { draftId: j.draftId, draftNo: j.draftNo, draftUrl: j.draftUrl, pxkNo: j.pxkNo, warnings: JSON.parse(j.warnings) } : null,
  error: ['needs_review', 'failed'].includes(j.status) ? j.lastError : '',
});
function config(env: StaffEnv) {
  const c = env.warehouseImageIntegration;
  if (!c || c.webhookToken.length < 32) throw new AppError(503, 'Luồng xin hàng bằng ảnh chưa được cấu hình.');
  try { const u = new URL(c.webhookUrl); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); } catch { throw new AppError(503, 'Webhook xin hàng bằng ảnh chưa hợp lệ.'); }
  return c;
}
const callbackOrigin = (env: StaffEnv) => {
  const raw = env.warehouseImageIntegration?.callbackOrigin || 'https://crm.minhlongonline.com';
  const u = new URL(raw); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new AppError(503, 'Địa chỉ callback CRM chưa hợp lệ.');
  return u.origin;
};

/** Claims exactly one queued image globally. The queue row is the cross-channel serialization lock. */
export async function dispatchNextWarehouseImageJob(env: StaffEnv): Promise<void> {
  const c = config(env), token = crypto.randomUUID(), tokenHash = sha256Hex(token), now = nowIso();
  const job = await env.db.transaction(async tx => {
    await tx.insert(queue).values({ id: queueId, updatedAt: now }).onConflictDoNothing();
    await tx.select().from(queue).where(eq(queue.id, queueId)).for('update');
    const [active] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, 'processing')).limit(1);
    if (active) return null;
    const [next] = await tx.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(1).for('update');
    if (!next) return null;
    await tx.update(jobs).set({ status: 'processing', callbackTokenHash: tokenHash, startedAt: now, updatedAt: now }).where(and(eq(jobs.id, next.id), eq(jobs.status, 'queued')));
    return next;
  });
  if (!job) return;
  try {
    const image = JSON.parse(job.imagePayload);
    const response = await (c.fetch ?? fetch)(c.webhookUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.webhookToken}` },
      body: JSON.stringify({ schema_version: 1, action: 'parse_warehouse_request_image', jobId: job.id, source: job.source, image,
        callback: { url: `${callbackOrigin(env)}/api/staff/integrations/warehouse-image-jobs/${encodeURIComponent(job.id)}/result`, token } }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`N8N_HTTP_${response.status}`);
  } catch (error) {
    await env.db.update(jobs).set({ status: 'failed', imagePayload: '', callbackTokenHash: null, finishedAt: nowIso(), lastError: error instanceof Error ? error.message : 'Không gửi được sang Madam Sen.', updatedAt: nowIso() }).where(and(eq(jobs.id, job.id), eq(jobs.callbackTokenHash, tokenHash)));
    await dispatchNextWarehouseImageJob(env).catch(() => undefined);
  }
}

async function createJob(env: StaffEnv, actorId: string, b: Record<string, unknown>) {
  config(env);
  const image = b.image as Record<string, unknown> | null;
  const name = typeof image?.name === 'string' ? image.name.trim() : '';
  const type = typeof image?.type === 'string' ? image.type : '';
  const data = typeof image?.data_base64 === 'string' ? image.data_base64 : '';
  const dataUrl = `data:${type};base64,${data}`;
  if (!name || name.length > 180 || !allowedImage.test(dataUrl) || data.length > 70000) throw new AppError(422, 'Ảnh không hợp lệ hoặc vượt quá dung lượng cho phép.');
  const imageHash = sha256Hex(`${type}:${data}`), now = nowIso(), id = crypto.randomUUID(), payload = JSON.stringify({ name, type, data_base64: data });
  const inserted = await env.db.insert(jobs).values({ id, imageHash, source: 'crm.minhlongonline.com', imagePayload: payload, status: 'queued', createdBy: actorId, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
  let row = inserted[0];
  if (!row) [row] = await env.db.select().from(jobs).where(eq(jobs.imageHash, imageHash));
  if (!row) throw new AppError(500, 'Không tạo được việc xử lý ảnh.');
  const waiting = await env.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.createdAt), asc(jobs.id));
  const position = Math.max(0, waiting.findIndex(x => x.id === row!.id) + 1);
  if (position !== row.positionHint) { await env.db.update(jobs).set({ positionHint: position }).where(eq(jobs.id, row.id)); row = { ...row, positionHint: position }; }
  const work = dispatchNextWarehouseImageJob(env);
  if (env.waitUntil) env.waitUntil(work.catch(() => undefined)); else await work;
  return view(row);
}

async function acceptResult(env: StaffEnv, id: string, token: string, b: Record<string, unknown>) {
  const got = sha256Hex(token), now = nowIso();
  const result = await env.db.transaction(async tx => {
    await tx.insert(queue).values({ id: queueId, updatedAt: now }).onConflictDoNothing();
    await tx.select().from(queue).where(eq(queue.id, queueId)).for('update');
    const [j] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
    if (!j) throw new AppError(404, 'Không có việc xử lý ảnh này.');
    if (!j.callbackTokenHash || j.callbackTokenHash !== got) throw new AppError(401, 'Callback không hợp lệ hoặc đã sử dụng.');
    if (j.status !== 'processing') throw new AppError(409, 'Việc xử lý ảnh không còn chờ kết quả.');
    const status = String(b.status || '');
    if (!['completed', 'needs_review', 'failed'].includes(status)) throw new AppError(422, 'Trạng thái kết quả không hợp lệ.');
    const text = (key: string, max = 300) => typeof b[key] === 'string' ? (b[key] as string).trim().slice(0, max) : '';
    const warnings = Array.isArray(b.warnings) ? b.warnings.filter(x => typeof x === 'string').slice(0, 20).map(x => x.slice(0, 300)) : [];
    if (status === 'completed' && !text('draft_id') && !text('draft_no')) throw new AppError(422, 'Kết quả hoàn tất phải có mã phiếu nháp.');
    const draftUrl = text('draft_url', 500); if (draftUrl) { try { const u = new URL(draftUrl); if (u.origin !== callbackOrigin(env) || u.username || u.password) throw new Error(); } catch { throw new AppError(422, 'Liên kết phiếu nháp không thuộc CRM.'); } }
    const [updated] = await tx.update(jobs).set({ status, imagePayload: '', callbackTokenHash: null, finishedAt: now, draftId: text('draft_id', 160) || null, draftNo: text('draft_no', 160) || null,
      draftUrl: draftUrl || null, pxkNo: text('pxk_no', 160) || null, warnings: JSON.stringify(warnings), lastError: status === 'completed' ? '' : text('error', 1000) || 'Cần kiểm tra thủ công.', updatedAt: now })
      .where(eq(jobs.id, id)).returning();
    return view(updated!);
  });
  const next = dispatchNextWarehouseImageJob(env);
  if (env.waitUntil) env.waitUntil(next.catch(() => undefined)); else await next;
  return result;
}

export function registerWarehouseImageJobRoutes(router: Router<StaffEnv>) {
  router.post('/warehouse-image-jobs', async c => json(await createJob(c.env, (c.state.session as SessionState).member.id, await readJson(c.req, 100_000)), 202), 'business');
  router.get('/warehouse-image-jobs/:id', async c => { const id = c.params.id || '', member = (c.state.session as SessionState).member; const [j] = await c.env.db.select().from(jobs).where(eq(jobs.id, id)); if (!j || (member.role !== 'manager' && j.createdBy !== member.id)) throw new AppError(404, 'Không có việc xử lý ảnh này.'); return json(view(j)); }, 'business');
  router.post('/integrations/warehouse-image-jobs/:id/result', async c => {
    const token = /^Bearer (.+)$/.exec(c.req.headers.get('authorization') || '')?.[1] || '';
    return json(await acceptResult(c.env, c.params.id || '', token, await readJson(c.req, 16_384)));
  }, 'warehouse-image-sync');
}
