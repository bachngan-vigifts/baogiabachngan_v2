/**
 * GÓP Ý PHÁT TRIỂN PHẦN MỀM (mọi nhân viên – khu vực `business`):
 *  - Gửi góp ý: loại, mức ảnh hưởng, mô tả, các bước, tối đa 3 ảnh; tự ghi trang đang dùng + thông tin máy. Gửi lặp cùng mã → không tạo bản thứ hai.
 *  - Công khai trong công ty (mọi người xem, +1 để ưu tiên) hoặc "Chỉ người xử lý xem".
 *  - Người có quyền `feedback.manage` (Manager luôn có): đổi trạng thái, ưu tiên, gộp trùng, trao đổi. Đổi trạng thái / trả lời → báo người gửi.
 *  - KHÔNG gửi gì ra ngoài CRM; ảnh nằm trong kho file private (link ký hạn 1 giờ).
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { FileStore } from '../../../core/storage/file-store.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { softwareFeedback as fb, softwareFeedbackComments as comments, softwareFeedbackPhotos as photos, softwareFeedbackVotes as votes } from '../schema.ts';
import {
  FEEDBACK_CLOSED, FEEDBACK_IMPACTS, FEEDBACK_IMPACT_LABEL, FEEDBACK_KINDS, FEEDBACK_KIND_LABEL, FEEDBACK_LIMITS as L, FEEDBACK_PRIORITIES, FEEDBACK_PRIORITY_LABEL, FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL, FEEDBACK_VISIBILITIES, canSeeFeedback, feedbackCode, type FeedbackStatus,
} from '../domain/feedback.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const me = (c: Ctx) => { const m = (c.state.session as SessionState | undefined)?.member; if (!m) throw new AppError(401, 'Vui lòng đăng nhập.'); return m; };
const manages = (c: Ctx) => can(me(c) as never, 'feedback.manage');
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const oneOf = <T extends string>(v: unknown, list: readonly T[], label: string): T => { if (!list.includes(v as T)) throw new AppError(400, `${label} không hợp lệ.`); return v as T; };
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+=*)$/;

function parsePhotos(raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > L.photos) throw new AppError(400, `Tối đa ${L.photos} ảnh.`);
  return list.map(p => {
    const m = typeof p === 'string' && p.length <= L.photoChars ? PHOTO_RE.exec(p) : null;
    if (!m) throw new AppError(400, 'Ảnh không hợp lệ hoặc quá lớn. Chụp lại rồi thử lại.');
    return { mime: 'image/' + m[1], ext: m[1] === 'jpeg' ? 'jpg' : m[1]!, bytes: Uint8Array.from(atob(m[2]!), ch => ch.charCodeAt(0)) };
  });
}
async function discard(files: FileStore | undefined, keys: string[]) { if (files && keys.length) try { await files.remove(keys); } catch { console.warn('feedback photo cleanup skipped'); } }

/** Người nhận thông báo góp ý mới: Manager + chức vụ được cấp quyền "Quản lý góp ý". */
async function handlers(env: StaffEnv) {
  const positions = (await env.db.select({ id: positionPermissions.positionId }).from(positionPermissions).where(eq(positionPermissions.permission, 'feedback.manage'))).map(r => r.id);
  const rows = await env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.active, true), isNull(employees.deletedAt),
    or(eq(employees.role, 'manager'), positions.length ? and(eq(employees.role, 'employee'), inArray(employees.positionId, positions)) : sql`false`)));
  return rows.map(r => r.id);
}

async function loadVisible(c: Ctx, id: string) {
  const [row] = await c.env.db.select().from(fb).where(eq(fb.id, id)).limit(1);
  if (!row || !canSeeFeedback(row, me(c).id, manages(c))) throw new AppError(404, 'Không tìm thấy góp ý.');
  return row;
}

export function registerFeedbackRoutes(router: Router<StaffEnv>) {
  router.get('/feedback', async c => {
    const m = me(c), manage = manages(c), q = c.url.searchParams, db = c.env.db;
    const statusQ = q.get('status') || 'open', kindQ = q.get('kind') || '', search = text(q.get('q'), 100), page = Math.max(1, Math.min(10_000, Number(q.get('page')) || 1));
    const visible = manage ? undefined : or(eq(fb.visibility, 'public'), eq(fb.createdBy, m.id));
    const filters: (SQL | undefined)[] = [visible,
      q.get('mine') === '1' ? eq(fb.createdBy, m.id) : undefined,
      kindQ ? eq(fb.kind, oneOf(kindQ, FEEDBACK_KINDS, 'Loại')) : undefined,
      statusQ === 'open' ? sql`${fb.status} not in ('done','wont_do','duplicate')` : statusQ === 'closed' ? inArray(fb.status, [...FEEDBACK_CLOSED]) : statusQ === 'all' ? undefined : eq(fb.status, oneOf(statusQ, FEEDBACK_STATUSES, 'Trạng thái')),
      search ? or(ilike(fb.title, `%${search.replace(/[%_\\]/g, '\\$&')}%`), ilike(fb.description, `%${search.replace(/[%_\\]/g, '\\$&')}%`), /^GY-?\d+$/i.test(search) ? eq(fb.ticketNo, Number(search.replace(/\D/g, ''))) : undefined) : undefined];
    const where = and(...filters);
    const voteCount = sql<number>`(select count(*) from ${votes} v where v.feedback_id = ${fb.id})`.mapWith(Number);
    const commentCount = sql<number>`(select count(*) from ${comments} k where k.feedback_id = ${fb.id} and k.kind = 'comment')`.mapWith(Number);
    const mine = sql<boolean>`exists(select 1 from ${votes} v where v.feedback_id = ${fb.id} and v.member_id = ${m.id})`;
    const order = q.get('sort') === 'new' ? [desc(fb.createdAt)] : q.get('sort') === 'updated' ? [desc(fb.updatedAt)] : [desc(voteCount), desc(fb.createdAt)];
    const [rows, [total], byStatus] = await Promise.all([
      db.select({ id: fb.id, ticketNo: fb.ticketNo, kind: fb.kind, impact: fb.impact, title: fb.title, status: fb.status, priority: fb.priority, visibility: fb.visibility,
        createdBy: fb.createdBy, authorName: employees.name, createdAt: fb.createdAt, updatedAt: fb.updatedAt, pageUrl: fb.pageUrl, votes: voteCount, comments: commentCount, voted: mine })
        .from(fb).leftJoin(employees, eq(employees.id, fb.createdBy)).where(where).orderBy(...order, asc(fb.id)).limit(L.pageSize).offset((page - 1) * L.pageSize),
      db.select({ n: count() }).from(fb).where(where),
      db.select({ status: fb.status, n: count() }).from(fb).where(and(visible)).groupBy(fb.status),
    ]);
    return json({ items: rows.map(r => ({ ...r, code: feedbackCode(r.ticketNo) })), total: total?.n ?? 0, page, pageSize: L.pageSize, manage,
      counts: Object.fromEntries(byStatus.map(r => [r.status, r.n])) });
  }, 'business');

  router.get('/feedback/:id', async c => {
    const row = await loadVisible(c, c.params.id!), m = me(c), db = c.env.db;
    const [author, thread, pics, [vote], [mineVote], dup] = await Promise.all([
      db.select({ name: employees.name }).from(employees).where(eq(employees.id, row.createdBy)).limit(1),
      db.select({ id: comments.id, kind: comments.kind, body: comments.body, createdAt: comments.createdAt, authorId: comments.authorId, authorName: employees.name })
        .from(comments).leftJoin(employees, eq(employees.id, comments.authorId)).where(eq(comments.feedbackId, row.id)).orderBy(asc(comments.createdAt), asc(comments.id)),
      db.select({ key: photos.fileKey }).from(photos).where(eq(photos.feedbackId, row.id)).orderBy(asc(photos.createdAt), asc(photos.id)),
      db.select({ n: count() }).from(votes).where(eq(votes.feedbackId, row.id)),
      db.select({ n: count() }).from(votes).where(and(eq(votes.feedbackId, row.id), eq(votes.memberId, m.id))),
      row.duplicateOf ? db.select({ id: fb.id, ticketNo: fb.ticketNo, title: fb.title, visibility: fb.visibility, createdBy: fb.createdBy }).from(fb).where(eq(fb.id, row.duplicateOf)).limit(1) : Promise.resolve([]),
    ]);
    const urls = pics.length && c.env.files ? await c.env.files.signedUrls(pics.map(p => p.key), 3600) : new Map<string, string>();
    const original = dup[0] && canSeeFeedback(dup[0], m.id, manages(c)) ? { id: dup[0].id, code: feedbackCode(dup[0].ticketNo), title: dup[0].title } : null;
    const { clientKey: _k, payloadHash: _h, ...rest } = row;
    return json({ ...rest, code: feedbackCode(row.ticketNo), authorName: author[0]?.name ?? '', votes: vote?.n ?? 0, voted: (mineVote?.n ?? 0) > 0,
      photos: pics.map(p => urls.get(p.key)).filter(Boolean), comments: thread, duplicateOfItem: original,
      canComment: manages(c) || row.createdBy === m.id, manage: manages(c), labels: { kind: FEEDBACK_KIND_LABEL[row.kind], impact: FEEDBACK_IMPACT_LABEL[row.impact], status: FEEDBACK_STATUS_LABEL[row.status] } });
  }, 'business');

  router.post('/feedback', async c => {
    const m = me(c), b = await readJson(c.req, 3_000_000), db = c.env.db;
    const key = typeof b.clientKey === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(b.clientKey) ? b.clientKey : null;
    if (!key) throw new AppError(400, 'Thiếu mã gửi. Tải lại trang rồi thử lại.');
    const input = {
      kind: oneOf(b.kind, FEEDBACK_KINDS, 'Loại góp ý'), impact: oneOf(b.impact, FEEDBACK_IMPACTS, 'Mức ảnh hưởng'),
      visibility: oneOf(b.visibility ?? 'public', FEEDBACK_VISIBILITIES, 'Phạm vi xem'),
      title: text(b.title, L.title), description: text(b.description, L.description), steps: text(b.steps, L.steps),
      // Chỉ nhận đường dẫn trong ứng dụng (#/…): không lưu link ngoài / javascript: để hiện lại thành liên kết.
      pageUrl: /^#\/[^\s<>"']*$/.test(text(b.pageUrl, L.pageUrl)) ? text(b.pageUrl, L.pageUrl) : '', clientInfo: text(b.clientInfo, L.clientInfo),
    };
    if (input.title.length < 5) throw new AppError(400, 'Tiêu đề cần ít nhất 5 ký tự.');
    if (input.description.length < 10) throw new AppError(400, 'Mô tả cần ít nhất 10 ký tự để người xử lý hiểu đúng.');
    const pics = parsePhotos(b.photos);
    const hash = sha256Hex(JSON.stringify({ ...input, photos: (Array.isArray(b.photos) ? b.photos : []).map((p: string) => sha256Hex(p)) }));
    const replay = async () => {
      const [prior] = await db.select({ id: fb.id, ticketNo: fb.ticketNo, payloadHash: fb.payloadHash }).from(fb).where(and(eq(fb.createdBy, m.id), eq(fb.clientKey, key))).limit(1);
      if (!prior) return null;
      if (prior.payloadHash !== hash) throw new AppError(409, 'Mã gửi đã dùng cho góp ý khác. Tải lại trang rồi gửi lại.');
      return json({ id: prior.id, code: feedbackCode(prior.ticketNo), replayed: true });
    };
    const again = await replay(); if (again) return again;
    const [recent] = await db.select({ n: count() }).from(fb).where(and(eq(fb.createdBy, m.id), gte(fb.createdAt, new Date(Date.now() - 3_600_000).toISOString())));
    if ((recent?.n ?? 0) >= L.perHour) throw new AppError(429, `Mỗi giờ gửi tối đa ${L.perHour} góp ý. Vui lòng thử lại sau.`);
    // Ảnh tải lên TRƯỚC giao dịch (I/O chậm không giữ khoá); giao dịch lỗi / gửi lặp → dọn file.
    const id = crypto.randomUUID(), at = nowIso(), files = c.env.files;
    if (pics.length && !files) throw new AppError(503, 'Chưa cấu hình kho file, tạm thời chưa gửi được ảnh. Gửi góp ý không kèm ảnh.');
    const saved: { id: string; fileKey: string; bytes: number }[] = [];
    try {
      for (const p of pics) { const pid = crypto.randomUUID(), fileKey = `software-feedback/${id}/${pid}.${p.ext}`; await files!.put(fileKey, p.bytes, p.mime); saved.push({ id: pid, fileKey, bytes: p.bytes.length }); }
      const ticketNo = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('software-feedback-ticket'))`);
        const [last] = await tx.select({ n: sql<number>`coalesce(max(${fb.ticketNo}), 0)`.mapWith(Number) }).from(fb);
        const no = (last?.n ?? 0) + 1;
        await tx.insert(fb).values({ id, ticketNo: no, ...input, createdBy: m.id, clientKey: key, payloadHash: hash, createdAt: at, updatedAt: at });
        if (saved.length) await tx.insert(photos).values(saved.map(s => ({ ...s, feedbackId: id, createdBy: m.id, createdAt: at })));
        return no;
      });
      const targets = await handlers(c.env);
      await notifyMany(c.env, targets, { eventType: 'software_feedback_new', actorId: m.id, url: '/index.html#/feedback/' + id, data: { feedbackId: id },
        title: `${input.impact === 'blocking' ? '⚠ CHẶN CÔNG VIỆC · ' : ''}Góp ý mới ${feedbackCode(ticketNo)}: ${input.title}`,
        body: `${m.name} · ${FEEDBACK_KIND_LABEL[input.kind]} · ảnh hưởng ${FEEDBACK_IMPACT_LABEL[input.impact]}` }).catch(() => {});
      return json({ id, code: feedbackCode(ticketNo) }, 201);
    } catch (e) {
      await discard(files, saved.map(s => s.fileKey));
      const again2 = await replay().catch(() => null); if (again2) return again2; // hai lượt gửi lặp chạy song song
      throw e;
    }
  }, 'business');

  router.post('/feedback/:id/vote', async c => {
    const row = await loadVisible(c, c.params.id!), m = me(c), b = await readJson(c.req, 1000);
    if (FEEDBACK_CLOSED.includes(row.status)) throw new AppError(409, 'Góp ý đã đóng, không nhận +1.');
    if (b.on === false) await c.env.db.delete(votes).where(and(eq(votes.feedbackId, row.id), eq(votes.memberId, m.id)));
    else await c.env.db.insert(votes).values({ feedbackId: row.id, memberId: m.id, createdAt: nowIso() }).onConflictDoNothing();
    const [n] = await c.env.db.select({ n: count() }).from(votes).where(eq(votes.feedbackId, row.id));
    return json({ votes: n?.n ?? 0, voted: b.on !== false });
  }, 'business');

  router.post('/feedback/:id/comments', async c => {
    const row = await loadVisible(c, c.params.id!), m = me(c), manage = manages(c), b = await readJson(c.req, 20_000);
    if (!manage && row.createdBy !== m.id) throw new AppError(403, 'Chỉ người gửi và người xử lý trao đổi trong góp ý này. Bấm +1 nếu bạn cũng gặp.');
    const body = text(b.body, L.comment); if (body.length < 2) throw new AppError(400, 'Nhập nội dung trao đổi.');
    const at = nowIso(), id = crypto.randomUUID();
    await c.env.db.transaction(async tx => {
      await tx.insert(comments).values({ id, feedbackId: row.id, authorId: m.id, kind: 'comment', body, createdAt: at });
      await tx.update(fb).set({ updatedAt: at }).where(eq(fb.id, row.id));
    });
    // Người gửi trả lời → báo người xử lý; người xử lý trả lời → báo người gửi.
    const to = row.createdBy === m.id ? await handlers(c.env) : [row.createdBy];
    await notifyMany(c.env, to, { eventType: 'software_feedback_comment', actorId: m.id, url: '/index.html#/feedback/' + row.id, data: { feedbackId: row.id },
      title: `Trao đổi mới ở góp ý ${feedbackCode(row.ticketNo)}`, body: `${m.name}: ${body.slice(0, 160)}` }).catch(() => {});
    return json({ id, createdAt: at }, 201);
  }, 'business');

  router.post('/feedback/:id/triage', async c => {
    if (!manages(c)) throw new AppError(403, 'Chỉ người có quyền "Quản lý góp ý" xử lý góp ý.');
    const row = await loadVisible(c, c.params.id!), m = me(c), b = await readJson(c.req, 5000), db = c.env.db;
    const status = b.status === undefined ? row.status : oneOf(b.status, FEEDBACK_STATUSES, 'Trạng thái') as FeedbackStatus;
    const priority = b.priority === undefined ? row.priority : b.priority === null || b.priority === '' ? null : oneOf(b.priority, FEEDBACK_PRIORITIES, 'Ưu tiên');
    const reason = text(b.reason, L.reason);
    if (status === 'wont_do' && status !== row.status && reason.length < 3) throw new AppError(400, 'Ghi lý do "Không làm" để người gửi hiểu.');
    let duplicateOf: string | null = status === 'duplicate' ? row.duplicateOf : null;
    if (status === 'duplicate') {
      const ref = text(b.duplicateOf, 100);
      if (ref) {
        const [orig] = await db.select({ id: fb.id, ticketNo: fb.ticketNo, duplicateOf: fb.duplicateOf }).from(fb)
          .where(/^GY-?\d+$/i.test(ref) ? eq(fb.ticketNo, Number(ref.replace(/\D/g, ''))) : eq(fb.id, ref)).limit(1);
        if (!orig || orig.id === row.id) throw new AppError(400, 'Không tìm thấy góp ý gốc để gộp (nhập mã dạng GY-0012).');
        if (orig.duplicateOf) throw new AppError(400, `${feedbackCode(orig.ticketNo)} đã là bản trùng; gộp vào góp ý gốc của nó.`);
        duplicateOf = orig.id;
      }
      if (!duplicateOf) throw new AppError(400, 'Chọn góp ý gốc để gộp (mã dạng GY-0012).');
    }
    if (status === row.status && priority === row.priority && duplicateOf === row.duplicateOf && !reason) return json({ ok: true, unchanged: true });
    const at = nowIso(), changes: string[] = [];
    if (status !== row.status) changes.push(`Trạng thái: ${FEEDBACK_STATUS_LABEL[row.status]} → ${FEEDBACK_STATUS_LABEL[status]}`);
    if (priority !== row.priority) changes.push(`Ưu tiên: ${row.priority ? FEEDBACK_PRIORITY_LABEL[row.priority] : 'chưa đặt'} → ${priority ? FEEDBACK_PRIORITY_LABEL[priority] : 'chưa đặt'}`);
    if (duplicateOf && duplicateOf !== row.duplicateOf) { const [o] = await db.select({ ticketNo: fb.ticketNo }).from(fb).where(eq(fb.id, duplicateOf)); changes.push(`Gộp vào ${feedbackCode(o!.ticketNo)}`); }
    if (reason) changes.push(`Lý do / ghi chú: ${reason}`);
    await db.transaction(async tx => {
      await tx.update(fb).set({ status, priority, duplicateOf, updatedAt: at }).where(eq(fb.id, row.id));
      await tx.insert(comments).values({ id: crypto.randomUUID(), feedbackId: row.id, authorId: m.id, kind: 'status', body: changes.join('\n'), createdAt: at });
    });
    if (status !== row.status || reason) await notifyMany(c.env, [row.createdBy], { eventType: 'software_feedback_status', actorId: m.id, url: '/index.html#/feedback/' + row.id, data: { feedbackId: row.id },
      title: `Góp ý ${feedbackCode(row.ticketNo)}: ${FEEDBACK_STATUS_LABEL[status]}`, body: (reason || row.title).slice(0, 200) }).catch(() => {});
    return json({ ok: true, status, priority, duplicateOf });
  }, 'business');
}
