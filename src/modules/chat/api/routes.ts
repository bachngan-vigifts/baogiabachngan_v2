import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { notify } from '../../notifications/api/routes.ts';
import { chatAttachments, chatConversations, chatMembers, chatMessages } from '../schema.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import { CHAT_FILE_TYPES, CHAT_LIMITS, CHAT_REF_TYPES, RECALL_MS, directKey } from '../domain/chat-config.ts';

type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Người chat được: nhân viên / Manager đang hoạt động (không gồm khách hàng, NCC). */
async function staffIds(c: Ctx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await c.env.db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.id, ids), eq(employees.active, true), notInArray(employees.role, ['customer', 'supplier'])));
  return rows.map(r => r.id);
}
/** Hội thoại mà tôi là thành viên (không thì 404). */
async function myConversation(c: Ctx, id: string) {
  const [row] = await c.env.db.select({ conv: chatConversations, lastReadAt: chatMembers.lastReadAt }).from(chatConversations)
    .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatConversations.id), eq(chatMembers.memberId, me(c).id)))
    .where(eq(chatConversations.id, id)).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy cuộc trò chuyện.');
  return row;
}
/** Danh sách hội thoại của tôi kèm tên hiển thị, tin cuối, số chưa đọc. */
async function conversationsOf(c: Ctx, onlyId?: string) {
  const m = me(c), db = c.env.db;
  const mine = await db.select({ conv: chatConversations, lastReadAt: chatMembers.lastReadAt }).from(chatConversations)
    .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatConversations.id), eq(chatMembers.memberId, m.id)))
    .where(onlyId ? eq(chatConversations.id, onlyId) : undefined).orderBy(desc(sql`coalesce(${chatConversations.lastMessageAt}, ${chatConversations.createdAt})`)).limit(200);
  if (!mine.length) return [];
  const ids = mine.map(r => r.conv.id);
  const [members, lasts, unread] = await Promise.all([
    db.select({ conversationId: chatMembers.conversationId, id: employees.id, name: employees.name, position: employees.positionId, avatar: employees.avatarKey }).from(chatMembers)
      .innerJoin(employees, eq(employees.id, chatMembers.memberId)).where(inArray(chatMembers.conversationId, ids)),
    db.selectDistinctOn([chatMessages.conversationId], { conversationId: chatMessages.conversationId, body: chatMessages.body, createdAt: chatMessages.createdAt, memberId: chatMessages.memberId,
      recalledAt: chatMessages.recalledAt, refJson: chatMessages.refJson })
      .from(chatMessages).where(inArray(chatMessages.conversationId, ids)).orderBy(chatMessages.conversationId, desc(chatMessages.createdAt)),
    db.select({ conversationId: chatMessages.conversationId, n: sql<number>`count(*)` }).from(chatMessages)
      .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.memberId, m.id)))
      .where(and(inArray(chatMessages.conversationId, ids), ne(chatMessages.memberId, m.id), sql`${chatMessages.createdAt} > coalesce(${chatMembers.lastReadAt}, '')`))
      .groupBy(chatMessages.conversationId),
  ]);
  return mine.map(({ conv }) => {
    const people = members.filter(x => x.conversationId === conv.id), others = people.filter(x => x.id !== m.id), last = lasts.find(x => x.conversationId === conv.id);
    return {
      id: conv.id, kind: conv.kind, title: conv.kind === 'direct' ? (others[0]?.name ?? 'Đã rời đi') : conv.title, createdBy: conv.createdBy,
      members: people.map(x => ({ id: x.id, name: x.name, avatar: x.avatar })), lastMessageAt: conv.lastMessageAt ?? conv.createdAt,
      last: last ? { body: preview(last).slice(0, 140), at: last.createdAt, mine: last.memberId === m.id, by: people.find(x => x.id === last.memberId)?.name ?? '' } : null,
      unread: Number(unread.find(x => x.conversationId === conv.id)?.n ?? 0),
    };
  });
}

/** Dòng xem trước trong danh sách hội thoại / thông báo. */
const preview = (x: { body: string; recalledAt: string | null; refJson: string }) => x.recalledAt ? 'Tin nhắn đã được thu hồi'
  : x.body || (x.refJson ? '🔗 ' + (parseRef(x.refJson)?.label ?? 'Liên kết') : '📎 Tệp đính kèm');
type Ref = { type: typeof CHAT_REF_TYPES[number]; id: string; label: string };
const parseRef = (raw: string): Ref | null => { try { return raw ? JSON.parse(raw) as Ref : null; } catch { return null; } };
/** Liên kết nhanh do giao diện gửi lên: loại hợp lệ, id + nhãn ngắn (người nhận vẫn phải có quyền mới mở được). */
function readRef(v: unknown): Ref | null {
  if (v === undefined || v === null || v === '') return null;
  const r = (typeof v === 'object' ? v : {}) as Record<string, unknown>, type = String(r.type), id = str(r.id, 80), label = str(r.label, 200);
  if (!(CHAT_REF_TYPES as readonly string[]).includes(type) || !/^[\w-]{1,80}$/.test(id) || !label) throw new AppError(400, 'Liên kết không hợp lệ.');
  return { type: type as Ref['type'], id, label };
}
const MSG_COLS = { id: chatMessages.id, memberId: chatMessages.memberId, body: chatMessages.body, refJson: chatMessages.refJson, recalledAt: chatMessages.recalledAt,
  createdAt: chatMessages.createdAt, name: employees.name, avatar: employees.avatarKey };
type MsgRow = { id: string; memberId: string; body: string; refJson: string; recalledAt: string | null; createdAt: string; name: string; avatar: string | null };
/** Gắn file đính kèm (kèm link tải có hạn 1 giờ) và liên kết vào tin; tin đã thu hồi chỉ còn dấu "đã thu hồi". */
async function decorate(c: Ctx, rows: MsgRow[]) {
  const ids = rows.filter(r => !r.recalledAt).map(r => r.id);
  const files = ids.length ? await c.env.db.select().from(chatAttachments).where(inArray(chatAttachments.messageId, ids)) : [];
  let urls = new Map<string, string>();
  if (files.length && c.env.files) { try { urls = await c.env.files.signedUrls(files.map(f => f.fileKey), 3600); } catch (e) { console.error('chat file sign failed', e instanceof Error ? e.message : e); } }
  const now = Date.now(), me_ = me(c).id;
  return rows.map(r => r.recalledAt
    ? { id: r.id, memberId: r.memberId, name: r.name, avatar: r.avatar, createdAt: r.createdAt, body: '', recalled: true, ref: null, files: [], canRecall: false }
    : { id: r.id, memberId: r.memberId, name: r.name, avatar: r.avatar, createdAt: r.createdAt, body: r.body, recalled: false, ref: parseRef(r.refJson),
      files: files.filter(f => f.messageId === r.id).map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes, url: urls.get(f.fileKey) ?? '' })),
      canRecall: r.memberId === me_ && now - Date.parse(r.createdAt) < RECALL_MS });
}

/**
 * Tin của một hội thoại (mới nhất trước khi đảo) + mốc "đã xem" của người khác; `full` kèm thông tin hội thoại.
 * `around` = mốc thời gian của một tin tìm được: lấy tin quanh mốc đó (nhảy tới tin cũ). `recalledSince`: id các tin bị thu hồi từ mốc này (để khung đang mở xoá đi).
 */
async function threadPayload(c: Ctx, convId: string, { after, before, around, recalledSince, full }: { after?: string | null; before?: string | null; around?: string | null; recalledSince?: string | null; full?: boolean } = {}) {
  const m = me(c), db = c.env.db, half = Math.floor(CHAT_LIMITS.page / 2);
  const base = () => db.select(MSG_COLS).from(chatMessages).innerJoin(employees, eq(employees.id, chatMessages.memberId));
  const [rows, newer, reads, conv, recalled] = await Promise.all([
    around ? base().where(and(eq(chatMessages.conversationId, convId), lte(chatMessages.createdAt, around))).orderBy(desc(chatMessages.createdAt)).limit(half)
      : base().where(and(eq(chatMessages.conversationId, convId), after ? gt(chatMessages.createdAt, after) : undefined, before ? lt(chatMessages.createdAt, before) : undefined))
        .orderBy(desc(chatMessages.createdAt)).limit(CHAT_LIMITS.page),
    around ? base().where(and(eq(chatMessages.conversationId, convId), gt(chatMessages.createdAt, around))).orderBy(asc(chatMessages.createdAt)).limit(half) : Promise.resolve([]),
    db.select({ memberId: chatMembers.memberId, lastReadAt: chatMembers.lastReadAt }).from(chatMembers).where(eq(chatMembers.conversationId, convId)),
    full ? conversationsOf(c, convId) : Promise.resolve(null),
    recalledSince ? db.select({ id: chatMessages.id }).from(chatMessages).where(and(eq(chatMessages.conversationId, convId), gte(chatMessages.recalledAt, recalledSince))).limit(200) : Promise.resolve([]),
  ]);
  const list = [...rows.reverse(), ...newer];
  return { messages: await decorate(c, list), more: around ? rows.length === half : rows.length === CHAT_LIMITS.page && !after, newer: around ? newer.length === half : false,
    reads: reads.filter(r => r.memberId !== m.id), recalledIds: recalled.map(r => r.id), now: nowIso(), ...(conv ? { conversation: conv[0] } : {}) };
}
/** Giờ Việt Nam (YYYY-MM-DD) → mốc ISO UTC đầu ngày / cuối ngày. */
const vnStart = (d: string) => new Date(Date.parse(d + 'T00:00:00+07:00')).toISOString();
const vnEnd = (d: string) => new Date(Date.parse(d + 'T00:00:00+07:00') + 86_400_000).toISOString();
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const B64_RE = /^[A-Za-z0-9+/]+=*$/;
function decodeB64(data: string) { const bin = atob(data); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

/** Số tin chưa đọc của một người (dùng cho /chat/unread và GET /pulse). */
export async function unreadChatCount(db: StaffEnv['db'], memberId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(chatMessages)
    .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.memberId, memberId)))
    .where(and(ne(chatMessages.memberId, memberId), sql`${chatMessages.createdAt} > coalesce(${chatMembers.lastReadAt}, '')`));
  return Number(r?.n ?? 0);
}

export function registerChatRoutes(router: Router<StaffEnv>) {
  /** Tổng tin chưa đọc (huy hiệu menu, hỏi định kỳ). */
  router.get('/chat/unread', async c => json({ unread: await unreadChatCount(c.env.db, me(c).id) }), 'business');

  router.get('/chat/conversations', async c => json({ conversations: await conversationsOf(c) }), 'business');

  /** Danh bạ: nhân viên có thể nhắn (trừ chính mình). */
  router.get('/chat/people', async c => {
    const rows = await c.env.db.select({ id: employees.id, name: employees.name, positionId: employees.positionId, avatar: employees.avatarKey }).from(employees)
      .where(and(eq(employees.active, true), notInArray(employees.role, ['customer', 'supplier']), ne(employees.id, me(c).id))).orderBy(asc(employees.name));
    return json({ people: rows });
  }, 'business');

  /** Mở (hoặc tạo) hội thoại 1-1 với một nhân viên. */
  router.post('/chat/direct', async c => {
    const m = me(c), other = str((await readJson(c.req, 2_000)).memberId, 80);
    if (!other || other === m.id || !(await staffIds(c, [other])).length) throw new AppError(400, 'Chọn nhân viên để nhắn tin.');
    const key = directKey(m.id, other), now = nowIso(), db = c.env.db;
    let [conv] = await db.select().from(chatConversations).where(eq(chatConversations.directKey, key)).limit(1);
    if (!conv) {
      const id = crypto.randomUUID();
      await db.insert(chatConversations).values({ id, kind: 'direct', title: '', directKey: key, createdBy: m.id, createdAt: now }).onConflictDoNothing();
      [conv] = await db.select().from(chatConversations).where(eq(chatConversations.directKey, key)).limit(1);
      await db.insert(chatMembers).values([m.id, other].map(memberId => ({ conversationId: conv!.id, memberId, joinedAt: now }))).onConflictDoNothing();
    }
    // Trả luôn tin nhắn + thông tin hội thoại: giao diện mở khung chat ngay, không cần gọi thêm lượt nữa.
    return json({ id: conv!.id, ...(await threadPayload(c, conv!.id, { full: true })) });
  }, 'business');

  /** Tạo nhóm chat (người tạo tự là thành viên). */
  router.post('/chat/groups', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), title = str(b.title, CHAT_LIMITS.title);
    if (!title) throw new AppError(400, 'Đặt tên nhóm.');
    const ids = await staffIds(c, [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).map(x => str(x, 80)).filter(Boolean))].slice(0, CHAT_LIMITS.groupMembers));
    if (!ids.filter(x => x !== m.id).length) throw new AppError(400, 'Chọn ít nhất một thành viên.');
    const id = crypto.randomUUID(), now = nowIso();
    await c.env.db.insert(chatConversations).values({ id, kind: 'group', title, createdBy: m.id, createdAt: now });
    await c.env.db.insert(chatMembers).values([...new Set([m.id, ...ids])].map(memberId => ({ conversationId: id, memberId, joinedAt: now, lastReadAt: memberId === m.id ? now : null })));
    await c.env.db.insert(chatMessages).values({ id: crypto.randomUUID(), conversationId: id, memberId: m.id, body: `${m.name} đã tạo nhóm "${title}".`, createdAt: now });
    await c.env.db.update(chatConversations).set({ lastMessageAt: now }).where(eq(chatConversations.id, id));
    return json({ id }, 201);
  }, 'business');

  /** Đổi tên nhóm, thêm / bớt thành viên (người tạo nhóm hoặc Manager). */
  router.put('/chat/groups/:id', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), { conv } = await myConversation(c, c.params.id!);
    if (conv.kind !== 'group') throw new AppError(400, 'Chỉ sửa được nhóm chat.');
    if (conv.createdBy !== m.id && m.role !== 'manager') throw new AppError(403, 'Chỉ người tạo nhóm hoặc Manager sửa được nhóm.');
    const now = nowIso(), notes: string[] = [];
    if (b.title !== undefined) { const t = str(b.title, CHAT_LIMITS.title); if (!t) throw new AppError(400, 'Đặt tên nhóm.'); await c.env.db.update(chatConversations).set({ title: t }).where(eq(chatConversations.id, conv.id)); notes.push(`đổi tên nhóm thành "${t}"`); }
    const add = await staffIds(c, (Array.isArray(b.addMemberIds) ? b.addMemberIds : []).map(x => str(x, 80)));
    if (add.length) { await c.env.db.insert(chatMembers).values(add.map(memberId => ({ conversationId: conv.id, memberId, joinedAt: now }))).onConflictDoNothing(); notes.push(`thêm ${add.length} thành viên`); }
    const remove = (Array.isArray(b.removeMemberIds) ? b.removeMemberIds : []).map(x => str(x, 80)).filter(x => x && x !== conv.createdBy);
    if (remove.length) { await c.env.db.delete(chatMembers).where(and(eq(chatMembers.conversationId, conv.id), inArray(chatMembers.memberId, remove))); notes.push(`bớt ${remove.length} thành viên`); }
    if (notes.length) {
      await c.env.db.insert(chatMessages).values({ id: crypto.randomUUID(), conversationId: conv.id, memberId: m.id, body: `${m.name} đã ${notes.join(', ')}.`, createdAt: now });
      await c.env.db.update(chatConversations).set({ lastMessageAt: now }).where(eq(chatConversations.id, conv.id));
    }
    return json({ ok: true });
  }, 'business');

  /** Rời nhóm. */
  router.post('/chat/:id/leave', async c => {
    const m = me(c), { conv } = await myConversation(c, c.params.id!);
    if (conv.kind !== 'group') throw new AppError(400, 'Không rời được cuộc trò chuyện 1-1.');
    await c.env.db.delete(chatMembers).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, m.id)));
    await c.env.db.insert(chatMessages).values({ id: crypto.randomUUID(), conversationId: conv.id, memberId: m.id, body: `${m.name} đã rời nhóm.`, createdAt: nowIso() });
    return json({ ok: true });
  }, 'business');

  /**
   * Tin nhắn của hội thoại. `after=<createdAt>` = chỉ tin mới (hỏi định kỳ khi đang mở); `before=<createdAt>` = tải tin cũ hơn.
   * Trả kèm mốc "đã xem" của người khác (hiện "Đã xem"). `full=1`: kèm thông tin hội thoại (mở lần đầu, đỡ một lượt gọi);
   * `read=1`: đánh dấu đã đọc luôn (đỡ một lượt gọi /read).
   */
  router.get('/chat/:id/messages', async c => {
    const m = me(c), { conv } = await myConversation(c, c.params.id!), p = c.url.searchParams;
    if (p.get('read') === '1') await c.env.db.update(chatMembers).set({ lastReadAt: nowIso() }).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, m.id)));
    return json(await threadPayload(c, conv.id, { after: p.get('after'), before: p.get('before'), around: p.get('around'), recalledSince: p.get('recalledSince'), full: p.get('full') === '1' }));
  }, 'business');

  /**
   * Gửi tin: chữ và/hoặc tối đa 3 file (base64, ≤ 6 MB / file, loại theo đuôi file) và/hoặc một liên kết nhanh.
   * File lưu ở bucket private; người còn lại trong hội thoại nhận Web Push (không lưu vào chuông – tin nhắn có hộp thư riêng).
   */
  router.post('/chat/:id/messages', async c => {
    const m = me(c), { conv } = await myConversation(c, c.params.id!);
    const b = await readJson(c.req, CHAT_LIMITS.files * Math.ceil(CHAT_LIMITS.fileBytes * 4 / 3) + 40_000);
    const body = str(b.body, CHAT_LIMITS.body), ref = readRef(b.ref), raw = Array.isArray(b.files) ? b.files : [];
    if (raw.length > CHAT_LIMITS.files) throw new AppError(400, `Mỗi tin gửi tối đa ${CHAT_LIMITS.files} file.`);
    const files = raw.map((f: unknown) => {
      const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>, name = str(x.name, 180).replace(/[\\/\u0000-\u001f]/g, '_'), data = String(x.data ?? '');
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '', mime = CHAT_FILE_TYPES[ext];
      if (!name || !mime) throw new AppError(400, `Không gửi được "${name || 'file'}": chỉ nhận ảnh, PDF, Excel, Word, CSV, TXT, ZIP.`);
      if (!B64_RE.test(data)) throw new AppError(400, `File "${name}" không hợp lệ.`);
      const bytes = decodeB64(data);
      if (!bytes.length || bytes.length > CHAT_LIMITS.fileBytes) throw new AppError(400, `File "${name}" phải nhỏ hơn 6 MB.`);
      return { name, mime, ext, bytes };
    });
    if (!body && !files.length && !ref) throw new AppError(400, 'Nhập nội dung tin nhắn.');
    if (files.length && !c.env.files) throw new AppError(503, 'Chưa cấu hình kho file, tạm thời chưa gửi được file.');
    const id = crypto.randomUUID(), now = nowIso();
    const stored = files.map(f => ({ ...f, id: crypto.randomUUID(), key: `chat/${conv.id}/${id}/${crypto.randomUUID()}.${f.ext}` }));
    for (const f of stored) await c.env.files!.put(f.key, f.bytes, f.mime);
    try {
      await c.env.db.insert(chatMessages).values({ id, conversationId: conv.id, memberId: m.id, body, refJson: ref ? JSON.stringify(ref) : '', createdAt: now });
      if (stored.length) await c.env.db.insert(chatAttachments).values(stored.map(f => ({ id: f.id, messageId: id, conversationId: conv.id, fileKey: f.key, name: f.name, mime: f.mime, bytes: f.bytes.length, createdAt: now })));
    } catch (e) { if (stored.length) await c.env.files!.remove(stored.map(f => f.key)).catch(() => {}); throw e; }
    await c.env.db.update(chatConversations).set({ lastMessageAt: now }).where(eq(chatConversations.id, conv.id));
    await c.env.db.update(chatMembers).set({ lastReadAt: now }).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, m.id)));
    const text = body || (ref ? '🔗 ' + ref.label : `📎 ${stored.map(f => f.name).join(', ')}`);
    // Web Push cho người nhận chạy nền: người gửi thấy "đã gửi" ngay, không phải chờ dịch vụ push.
    const push = (async () => {
      const others = (await c.env.db.select({ id: chatMembers.memberId }).from(chatMembers).where(and(eq(chatMembers.conversationId, conv.id), ne(chatMembers.memberId, m.id)))).map(r => r.id);
      await Promise.all(others.map(to => notify(c.env, { eventType: 'chat_message', title: conv.kind === 'group' ? `${conv.title} · ${m.name}` : m.name, body: text.slice(0, 160),
        url: `/index.html#/chat/${conv.id}`, targetMemberId: to, actorId: m.id, data: { conversationId: conv.id }, persist: false })));
    })().catch(() => console.error('chat push failed'));
    if (c.env.waitUntil) c.env.waitUntil(push); else await push;
    return json({ id, createdAt: now }, 201);
  }, 'business');

  /** Thu hồi tin: chỉ người gửi, trong 4 giờ. Nội dung, liên kết và file bị xoá; mọi người thấy "Tin nhắn đã được thu hồi". */
  router.post('/chat/:id/messages/:messageId/recall', async c => {
    const m = me(c), { conv } = await myConversation(c, c.params.id!);
    const [msg] = await c.env.db.select().from(chatMessages).where(and(eq(chatMessages.id, c.params.messageId!), eq(chatMessages.conversationId, conv.id))).limit(1);
    if (!msg) throw new AppError(404, 'Không tìm thấy tin nhắn.');
    if (msg.memberId !== m.id) throw new AppError(403, 'Chỉ người gửi thu hồi được tin nhắn.');
    if (msg.recalledAt) return json({ ok: true });
    if (Date.now() - Date.parse(msg.createdAt) >= RECALL_MS) throw new AppError(409, 'Chỉ thu hồi được tin nhắn gửi trong vòng 4 giờ.', 'RECALL_EXPIRED');
    const files = await c.env.db.select({ key: chatAttachments.fileKey }).from(chatAttachments).where(eq(chatAttachments.messageId, msg.id));
    await c.env.db.transaction(async tx => {
      await tx.delete(chatAttachments).where(eq(chatAttachments.messageId, msg.id));
      await tx.update(chatMessages).set({ body: '', refJson: '', recalledAt: nowIso() }).where(eq(chatMessages.id, msg.id));
    });
    if (files.length && c.env.files) await c.env.files.remove(files.map(f => f.key)).catch(e => console.error('chat file remove failed', e instanceof Error ? e.message : e));
    return json({ ok: true });
  }, 'business');

  /** Đánh dấu đã đọc đến hiện tại. */
  router.post('/chat/:id/read', async c => {
    const { conv } = await myConversation(c, c.params.id!);
    await c.env.db.update(chatMembers).set({ lastReadAt: nowIso() }).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, me(c).id)));
    return json({ ok: true });
  }, 'business');

  /**
   * Tìm tin nhắn cũ trong các hội thoại của tôi: theo chữ (không dấu cũng được) và/hoặc khoảng ngày (giờ Việt Nam).
   * `conversationId` = chỉ tìm trong một hội thoại. Bỏ qua tin đã thu hồi.
   */
  router.get('/chat/search', async c => {
    const m = me(c), p = c.url.searchParams, q = str(p.get('q'), 200), from = p.get('from'), to = p.get('to'), convId = str(p.get('conversationId'), 80);
    if (!q && !isDay(from) && !isDay(to)) throw new AppError(400, 'Nhập chữ cần tìm hoặc chọn ngày.');
    const rows = await c.env.db.select({ ...MSG_COLS, conversationId: chatMessages.conversationId }).from(chatMessages)
      .innerJoin(employees, eq(employees.id, chatMessages.memberId))
      .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.memberId, m.id)))
      .where(and(isNull(chatMessages.recalledAt), convId ? eq(chatMessages.conversationId, convId) : undefined,
        isDay(from) ? gte(chatMessages.createdAt, vnStart(from)) : undefined, isDay(to) ? lt(chatMessages.createdAt, vnEnd(to)) : undefined,
        q ? matchAllWords(foldSql(chatMessages.body, chatMessages.refJson), q) : undefined))
      .orderBy(desc(chatMessages.createdAt)).limit(CHAT_LIMITS.search);
    const convs = await conversationsOf(c);
    return json({ results: rows.map(r => ({ id: r.id, conversationId: r.conversationId, conversation: convs.find(x => x.id === r.conversationId)?.title ?? '',
      name: r.name, memberId: r.memberId, createdAt: r.createdAt, body: preview(r).slice(0, 300) })) });
  }, 'business');

  router.get('/chat/:id', async c => {
    await myConversation(c, c.params.id!);
    const [conv] = await conversationsOf(c, c.params.id!);
    return json({ conversation: conv });
  }, 'business');
}
