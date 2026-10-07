import { and, asc, desc, eq, gt, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { notify } from '../../notifications/api/routes.ts';
import { chatConversations, chatMembers, chatMessages } from '../schema.ts';
import { CHAT_LIMITS, directKey } from '../domain/chat-config.ts';

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
    db.selectDistinctOn([chatMessages.conversationId], { conversationId: chatMessages.conversationId, body: chatMessages.body, createdAt: chatMessages.createdAt, memberId: chatMessages.memberId })
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
      last: last ? { body: last.body.slice(0, 140), at: last.createdAt, mine: last.memberId === m.id, by: people.find(x => x.id === last.memberId)?.name ?? '' } : null,
      unread: Number(unread.find(x => x.conversationId === conv.id)?.n ?? 0),
    };
  });
}

/** Tin của một hội thoại (mới nhất trước khi đảo) + mốc "đã xem" của người khác; `full` kèm thông tin hội thoại. */
async function threadPayload(c: Ctx, convId: string, { after, before, full }: { after?: string | null; before?: string | null; full?: boolean } = {}) {
  const m = me(c);
  const [rows, reads, conv] = await Promise.all([
    c.env.db.select({ id: chatMessages.id, memberId: chatMessages.memberId, body: chatMessages.body, createdAt: chatMessages.createdAt, name: employees.name, avatar: employees.avatarKey })
      .from(chatMessages).innerJoin(employees, eq(employees.id, chatMessages.memberId))
      .where(and(eq(chatMessages.conversationId, convId), after ? gt(chatMessages.createdAt, after) : undefined, before ? lt(chatMessages.createdAt, before) : undefined))
      .orderBy(desc(chatMessages.createdAt)).limit(CHAT_LIMITS.page),
    c.env.db.select({ memberId: chatMembers.memberId, lastReadAt: chatMembers.lastReadAt }).from(chatMembers).where(eq(chatMembers.conversationId, convId)),
    full ? conversationsOf(c, convId) : Promise.resolve(null),
  ]);
  return { messages: rows.reverse(), more: rows.length === CHAT_LIMITS.page && !after, reads: reads.filter(r => r.memberId !== m.id), ...(conv ? { conversation: conv[0] } : {}) };
}

export function registerChatRoutes(router: Router<StaffEnv>) {
  /** Tổng tin chưa đọc (huy hiệu menu, hỏi định kỳ). */
  router.get('/chat/unread', async c => {
    const m = me(c);
    const [r] = await c.env.db.select({ n: sql<number>`count(*)` }).from(chatMessages)
      .innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.memberId, m.id)))
      .where(and(ne(chatMessages.memberId, m.id), sql`${chatMessages.createdAt} > coalesce(${chatMembers.lastReadAt}, '')`));
    return json({ unread: Number(r?.n ?? 0) });
  }, 'business');

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
    return json(await threadPayload(c, conv.id, { after: p.get('after'), before: p.get('before'), full: p.get('full') === '1' }));
  }, 'business');

  /** Gửi tin. Người còn lại trong hội thoại nhận Web Push (không lưu vào chuông – tin nhắn có hộp thư riêng). */
  router.post('/chat/:id/messages', async c => {
    const m = me(c), { conv } = await myConversation(c, c.params.id!), body = str((await readJson(c.req, 20_000)).body, CHAT_LIMITS.body);
    if (!body) throw new AppError(400, 'Nhập nội dung tin nhắn.');
    const id = crypto.randomUUID(), now = nowIso();
    await c.env.db.insert(chatMessages).values({ id, conversationId: conv.id, memberId: m.id, body, createdAt: now });
    await c.env.db.update(chatConversations).set({ lastMessageAt: now }).where(eq(chatConversations.id, conv.id));
    await c.env.db.update(chatMembers).set({ lastReadAt: now }).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, m.id)));
    // Web Push cho người nhận chạy nền: người gửi thấy "đã gửi" ngay, không phải chờ dịch vụ push.
    const push = (async () => {
      const others = (await c.env.db.select({ id: chatMembers.memberId }).from(chatMembers).where(and(eq(chatMembers.conversationId, conv.id), ne(chatMembers.memberId, m.id)))).map(r => r.id);
      await Promise.all(others.map(to => notify(c.env, { eventType: 'chat_message', title: conv.kind === 'group' ? `${conv.title} · ${m.name}` : m.name, body: body.slice(0, 160),
        url: `/index.html#/chat/${conv.id}`, targetMemberId: to, actorId: m.id, data: { conversationId: conv.id }, persist: false })));
    })().catch(() => console.error('chat push failed'));
    if (c.env.waitUntil) c.env.waitUntil(push); else await push;
    return json({ id, createdAt: now }, 201);
  }, 'business');

  /** Đánh dấu đã đọc đến hiện tại. */
  router.post('/chat/:id/read', async c => {
    const { conv } = await myConversation(c, c.params.id!);
    await c.env.db.update(chatMembers).set({ lastReadAt: nowIso() }).where(and(eq(chatMembers.conversationId, conv.id), eq(chatMembers.memberId, me(c).id)));
    return json({ ok: true });
  }, 'business');

  router.get('/chat/:id', async c => {
    await myConversation(c, c.params.id!);
    const [conv] = await conversationsOf(c, c.params.id!);
    return json({ conversation: conv });
  }, 'business');
}
