import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { decryptCookie, encryptCookie } from '../../integrations/domain/sapo-session.ts';
import { webNotificationReads, webNotifications, webPushKeys, webPushSubscriptions } from '../schema.ts';
import { encryptPushPayload, generateVapidKeys, vapidAuthorization, type VapidKeys } from '../domain/web-push.ts';

const clean = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const SUBJECT = 'mailto:info@quatangvigifts.com';

/** Khoá VAPID: tự sinh lần đầu, khoá riêng mã hoá bằng SAPO_SYNC_TOKEN. Chưa có mã bí mật thì chỉ lưu thông báo (không đẩy). */
async function vapidKeys(env: StaffEnv): Promise<VapidKeys | null> {
  const secret = env.sapoSyncToken ?? '';
  if (secret.length < 32) return null;
  let [row] = await env.db.select().from(webPushKeys).where(eq(webPushKeys.id, 'default')).limit(1);
  if (!row) {
    const k = await generateVapidKeys();
    await env.db.insert(webPushKeys).values({ id: 'default', publicKey: k.publicKey, encryptedPrivateKey: await encryptCookie(secret, k.privateKey), createdAt: nowIso() }).onConflictDoNothing();
    [row] = await env.db.select().from(webPushKeys).where(eq(webPushKeys.id, 'default')).limit(1);
  }
  const privateKey = row ? await decryptCookie(secret, row.encryptedPrivateKey) : '';
  return row && privateKey ? { publicKey: row.publicKey, privateKey } : null;
}

export interface NotifyInput {
  eventType: string; title: string; body?: string; url?: string;
  /** Gửi cho đúng một tài khoản (nhân viên phụ trách / khách). Bỏ trống = theo vai trò `targetRole`. */
  targetMemberId?: string | null; targetRole?: 'manager' | 'employee' | 'customer' | 'all';
  actorId?: string | null; data?: Record<string, unknown>;
}

/**
 * Tạo thông báo (lưu lại để trang tự làm mới + chuông thông báo) và đẩy Web Push tới các trình duyệt đã bật thông báo.
 * Không bao giờ làm hỏng thao tác chính: lỗi đẩy chỉ ghi nhận trên subscription.
 */
export async function notify(env: StaffEnv, n: NotifyInput) {
  const note = {
    id: crypto.randomUUID(), eventType: clean(n.eventType, 80), title: clean(n.title, 180), body: clean(n.body, 500), url: clean(n.url || '/', 500),
    targetRole: n.targetMemberId ? null : (n.targetRole ?? 'manager'), targetMemberId: n.targetMemberId ?? null, actorId: n.actorId ?? null,
    dataJson: JSON.stringify(n.data ?? {}), createdAt: nowIso(),
  };
  try { await env.db.insert(webNotifications).values(note); } catch (e) { console.error('notify insert failed'); return { ok: false, sent: 0 }; }
  let sent = 0;
  try {
    const keys = await vapidKeys(env); if (!keys) return { ok: true, sent };
    const subs = await env.db.select({ id: webPushSubscriptions.id, endpoint: webPushSubscriptions.endpoint, p256dh: webPushSubscriptions.p256dh, auth: webPushSubscriptions.auth })
      .from(webPushSubscriptions).innerJoin(employees, and(eq(employees.id, webPushSubscriptions.memberId), eq(employees.active, true)))
      .where(and(isNull(webPushSubscriptions.disabledAt), note.targetMemberId ? eq(webPushSubscriptions.memberId, note.targetMemberId)
        : note.targetRole === 'all' ? undefined : eq(employees.role, note.targetRole as 'manager')));
    const payload = JSON.stringify({ id: note.id, eventType: note.eventType, title: note.title, body: note.body, url: note.url, data: n.data ?? {} });
    const doFetch = env.pushFetch ?? fetch;
    await Promise.all(subs.map(async s => {
      try {
        const res = await doFetch(s.endpoint, { method: 'POST', body: await encryptPushPayload(payload, s.p256dh, s.auth) as BodyInit,
          headers: { Authorization: await vapidAuthorization(s.endpoint, keys, SUBJECT), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' } });
        if (res.status === 404 || res.status === 410) await env.db.update(webPushSubscriptions).set({ disabledAt: nowIso(), updatedAt: nowIso(), failureCount: sql`${webPushSubscriptions.failureCount} + 1` }).where(eq(webPushSubscriptions.id, s.id));
        else if (res.ok) { sent++; await env.db.update(webPushSubscriptions).set({ lastSeenAt: nowIso(), failureCount: 0, updatedAt: nowIso() }).where(eq(webPushSubscriptions.id, s.id)); }
        else await env.db.update(webPushSubscriptions).set({ failureCount: sql`${webPushSubscriptions.failureCount} + 1`, updatedAt: nowIso() }).where(eq(webPushSubscriptions.id, s.id));
      } catch { /* mạng lỗi: bỏ qua, lần sau gửi lại */ }
    }));
  } catch { console.error('web push dispatch failed'); }
  return { ok: true, sent, id: note.id };
}

/** Thông báo của một người: gửi đích danh, hoặc theo vai trò của họ. */
const mine = (m: { id: string; role: string }) => or(eq(webNotifications.targetMemberId, m.id),
  and(isNull(webNotifications.targetMemberId), or(eq(webNotifications.targetRole, 'all'), eq(webNotifications.targetRole, m.role))));

export function registerNotificationRoutes(router: Router<StaffEnv>) {
  router.get('/push/config', async c => {
    const keys = await vapidKeys(c.env);
    return json({ enabled: !!keys, publicKey: keys?.publicKey ?? '' });
  }, 'self');

  /** Trình duyệt bật thông báo: lưu PushSubscription (endpoint + khoá) cho tài khoản đang đăng nhập. */
  router.post('/push/subscribe', async c => {
    const me = (c.state.session as SessionState).member, b = await readJson(c.req, 8_000), sub = (b.subscription ?? b) as Record<string, any>;
    const endpoint = clean(sub?.endpoint, 2000), p256dh = clean(sub?.keys?.p256dh, 300), auth = clean(sub?.keys?.auth, 300);
    if (!/^https:\/\/.+/i.test(endpoint) || !p256dh || !auth) throw new AppError(400, 'Đăng ký nhận thông báo không hợp lệ.');
    const now = nowIso(), ua = clean(c.req.headers.get('user-agent'), 500);
    await c.env.db.insert(webPushSubscriptions).values({ id: crypto.randomUUID(), memberId: me.id, endpoint, p256dh, auth, userAgent: ua, createdAt: now, updatedAt: now, lastSeenAt: now, disabledAt: null, failureCount: 0 })
      .onConflictDoUpdate({ target: webPushSubscriptions.endpoint, set: { memberId: me.id, p256dh, auth, userAgent: ua, updatedAt: now, lastSeenAt: now, disabledAt: null, failureCount: 0 } });
    return json({ ok: true });
  }, 'self');

  router.post('/push/unsubscribe', async c => {
    const me = (c.state.session as SessionState).member, endpoint = clean((await readJson(c.req, 4_000)).endpoint, 2000);
    if (endpoint) await c.env.db.update(webPushSubscriptions).set({ disabledAt: nowIso(), updatedAt: nowIso() }).where(and(eq(webPushSubscriptions.endpoint, endpoint), eq(webPushSubscriptions.memberId, me.id)));
    return json({ ok: true });
  }, 'self');

  /** Chuông thông báo + trang tự làm mới: `?since=<createdAt>` chỉ lấy thông báo mới hơn. */
  router.get('/notifications', async c => {
    const me = (c.state.session as SessionState).member, since = c.url.searchParams.get('since');
    const rows = await c.env.db.select({ n: webNotifications, readAt: webNotificationReads.readAt, actorName: employees.name }).from(webNotifications)
      .leftJoin(webNotificationReads, and(eq(webNotificationReads.notificationId, webNotifications.id), eq(webNotificationReads.memberId, me.id)))
      .leftJoin(employees, eq(employees.id, webNotifications.actorId))
      .where(and(mine(me), since ? gt(webNotifications.createdAt, since) : undefined)).orderBy(desc(webNotifications.createdAt)).limit(30);
    const notifications = rows.map(r => ({ id: r.n.id, eventType: r.n.eventType, title: r.n.title, body: r.n.body, url: r.n.url, createdAt: r.n.createdAt,
      actorName: r.actorName ?? '', readAt: r.readAt ?? null, data: (() => { try { return JSON.parse(r.n.dataJson); } catch { return {}; } })() }));
    return json({ notifications, unreadCount: notifications.filter(x => !x.readAt).length });
  }, 'self');

  router.post('/notifications/read', async c => {
    const me = (c.state.session as SessionState).member, b = await readJson(c.req, 8_000);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(x)).slice(0, 50) as string[] : [];
    const targets = b.all === true
      ? (await c.env.db.select({ id: webNotifications.id }).from(webNotifications).where(mine(me)).orderBy(desc(webNotifications.createdAt)).limit(100)).map(r => r.id)
      : ids.length ? (await c.env.db.select({ id: webNotifications.id }).from(webNotifications).where(and(mine(me), inArray(webNotifications.id, ids)))).map(r => r.id) : [];
    const at = nowIso();
    for (const id of targets) await c.env.db.insert(webNotificationReads).values({ notificationId: id, memberId: me.id, readAt: at }).onConflictDoNothing();
    return json({ ok: true, read: targets.length });
  }, 'self');
}
