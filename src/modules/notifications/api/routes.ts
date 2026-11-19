import { boundedMap } from '../../../core/async/bounded-map.ts';
import { notificationScope, type NotificationScope } from './recipient-scope.ts';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { decryptCookie, encryptCookie } from '../../integrations/domain/sapo-session.ts';
import { webNotificationReads, webNotifications, webPushAttempts, webPushKeys, webPushSubscriptions } from '../schema.ts';
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
  /** false = chỉ đẩy Web Push, không lưu vào chuông thông báo (vd. tin nhắn chat – có hộp thư riêng). */
  persist?: boolean;
  /** Internal event identity; deduplicate persisted events per recipient before sending Web Push. */
  dedupeKey?: string;
  /** true = chờ gửi xong mới trả lời (trang "Gửi thử" cần kết quả từng thiết bị). Mặc định gửi nền. */
  wait?: boolean;
}

/**
 * Gửi cùng một thông báo cho nhiều người (mỗi người một bản ghi + Web Push), bỏ trùng và bỏ chính người thao tác (`actorId`).
 * `ids` = 'managers' → mọi Manager đang làm việc · 'approvers' → Manager + nhân viên được Manager bật cờ "Được duyệt" (việc chờ duyệt).
 */
export async function notifyMany(env: StaffEnv, ids: (string | null | undefined)[] | 'managers' | 'approvers', n: Omit<NotifyInput, 'targetMemberId' | 'targetRole'>, except: readonly (string | null | undefined)[] = [], requestScope?: NotificationScope) {
  try {
    const scope = requestScope ?? await notificationScope(env.db);
    const list = typeof ids === 'string' ? scope.people.filter(m => ids === 'managers' ? m.role === 'manager'
      : m.role === 'manager' || m.role === 'employee' && m.canApprove).map(m => m.id) : ids;
    const candidates = [...new Set(list.filter((x): x is string => !!x && x !== n.actorId && !except.includes(x)))];
    const targets = await scope.recipients(n, candidates);
    await boundedMap(targets,4,id => deliver(env, { ...n, targetMemberId: id }));
    return targets.length;
  } catch (error) {
    console.error('notification recipient authorization failed', n.eventType, error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Kết quả gửi tới một thiết bị (trả cho /push/test và ghi nhật ký). */
export interface PushResult { subscriptionId: string | null; memberId: string | null; status: number | null; error: string }
const NO_KEYS = 'Máy chủ chưa bật thông báo đẩy (thiếu secret SAPO_SYNC_TOKEN ≥ 32 ký tự).';
const NO_DEVICE = 'Người nhận chưa bật thông báo trên thiết bị nào.';
/** Tên thiết bị dễ đọc từ user-agent: "iPhone · Safari", "Windows · Chrome"… */
export function deviceLabel(ua: string) {
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Khác';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
const host = (url: string) => { try { return new URL(url).host; } catch { return '?'; } };

/** Ghi nhật ký gửi push (không bao giờ làm hỏng thao tác chính). Thỉnh thoảng xoá dòng cũ hơn 30 ngày. */
async function logAttempts(env: StaffEnv, notificationId: string, eventType: string, rows: PushResult[]) {
  if (!rows.length) return;
  const at = nowIso();
  try {
    await env.db.insert(webPushAttempts).values(rows.map(r => ({ id: crypto.randomUUID(), notificationId, eventType, memberId: r.memberId, subscriptionId: r.subscriptionId,
      status: r.status, error: r.error.slice(0, 500), createdAt: at })));
    if (Math.random() < 0.02) await env.db.delete(webPushAttempts).where(lt(webPushAttempts.createdAt, new Date(Date.now() - 30 * 86_400_000).toISOString()));
  } catch (e) { console.error('web push log failed', e instanceof Error ? e.message : e); }
}

/**
 * Tạo thông báo (lưu lại để trang tự làm mới + chuông thông báo) và đẩy Web Push tới các trình duyệt đã bật thông báo.
 * Không bao giờ làm hỏng thao tác chính. Mọi lần gửi (kể cả không gửi được) đều ghi vào `web_push_attempts`
 * và trạng thái gần nhất của từng thiết bị (`last_status`, `last_error`), để kiểm tra máy có nhận được không.
 */
export async function notify(env: StaffEnv, n: NotifyInput): Promise<{ ok: boolean; sent: number; id?: string; results: PushResult[] }> {
  try {
    const scope = await notificationScope(env.db);
    const candidates = n.targetMemberId ? [n.targetMemberId] : scope.people
      .filter(m => n.targetRole === 'all' || m.role === (n.targetRole ?? 'manager')).map(m => m.id);
    const targets = await scope.recipients(n, candidates);
    const results = await boundedMap(targets,4,id => deliver(env, { ...n, targetMemberId: id }));
    return { ok: results.every(r => r.ok), sent: results.reduce((sum, r) => sum + r.sent, 0),
      id: results[0]?.id, results: results.flatMap(r => r.results) };
  } catch (error) {
    console.error('notification recipient authorization failed', n.eventType, error instanceof Error ? error.message : error);
    return { ok: false, sent: 0, results: [] };
  }
}

/** Only called after recipient authorization; persist and push always use the same explicit recipient. */
async function deliver(env: StaffEnv, n: NotifyInput): Promise<{ ok: boolean; sent: number; id?: string; results: PushResult[] }> {
  const id = n.dedupeKey ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([n.eventType,n.dedupeKey,n.targetMemberId]))))].map(b=>b.toString(16).padStart(2,'0')).join('') : crypto.randomUUID();
  const note = {
    id, eventType: clean(n.eventType, 80), title: clean(n.title, 180), body: clean(n.body, 500), url: clean(n.url || '/', 500),
    targetRole: n.targetMemberId ? null : (n.targetRole ?? 'manager'), targetMemberId: n.targetMemberId ?? null, actorId: n.actorId ?? null,
    dataJson: JSON.stringify(n.data ?? {}), createdAt: nowIso(),
  };
  if (n.persist !== false) {
    try {
      if(n.dedupeKey){
        const inserted=await env.db.insert(webNotifications).values(note).onConflictDoNothing({target:webNotifications.id}).returning({id:webNotifications.id});
        if(!inserted.length)return {ok:true,sent:0,id:note.id,results:[]};
      }else await env.db.insert(webNotifications).values(note);
    }
    catch (e) { console.error('notify insert failed', note.eventType, e instanceof Error ? e.message : e); return { ok: false, sent: 0, results: [] }; }
  }
  // Web Push gọi dịch vụ ngoài (chậm 0,3–1,5 giây / thiết bị): chạy nền sau khi trả lời để nút thao tác không phải chờ.
  // Bản ghi chuông thông báo ở trên vẫn lưu ngay. Không có waitUntil (test / máy chủ thử) thì chờ như cũ.
  if (env.waitUntil && !n.wait) {
    env.waitUntil(pushTo(env, n, note).catch(e => console.error('web push background failed', e instanceof Error ? e.message : e)));
    return { ok: true, sent: 0, id: note.id, results: [] };
  }
  return pushTo(env, n, note);
}

type StoredNote = { id: string; eventType: string; title: string; body: string; url: string; targetRole: string | null; targetMemberId: string | null };
async function pushTo(env: StaffEnv, n: NotifyInput, note: StoredNote): Promise<{ ok: boolean; sent: number; id?: string; results: PushResult[] }> {
  const results: PushResult[] = [];
  try {
    const keys = await vapidKeys(env);
    if (!keys) {
      console.error('web push skipped:', NO_KEYS);
      results.push({ subscriptionId: null, memberId: note.targetMemberId, status: null, error: NO_KEYS });
    } else {
      const subs = await env.db.select({ id: webPushSubscriptions.id, memberId: webPushSubscriptions.memberId, endpoint: webPushSubscriptions.endpoint, p256dh: webPushSubscriptions.p256dh, auth: webPushSubscriptions.auth })
        .from(webPushSubscriptions).innerJoin(employees, and(eq(employees.id, webPushSubscriptions.memberId), eq(employees.active, true), isNull(employees.deletedAt)))
        .where(and(isNull(webPushSubscriptions.disabledAt), note.targetMemberId ? eq(webPushSubscriptions.memberId, note.targetMemberId)
          : note.targetRole === 'all' ? undefined : eq(employees.role, note.targetRole as 'manager')));
      if (!subs.length) results.push({ subscriptionId: null, memberId: note.targetMemberId, status: null, error: NO_DEVICE });
      const payload = JSON.stringify({ id: note.id, eventType: note.eventType, title: note.title, body: note.body, url: note.url, data: n.data ?? {} });
      const doFetch = env.pushFetch ?? fetch;
      results.push(...await Promise.all(subs.map(async (s): Promise<PushResult> => {
        let status = 0, error = '';
        try {
          const res = await doFetch(s.endpoint, { method: 'POST', body: await encryptPushPayload(payload, s.p256dh, s.auth) as BodyInit,
            headers: { Authorization: await vapidAuthorization(s.endpoint, keys, SUBJECT), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' } });
          status = res.status;
          if (!res.ok) error = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300) || `HTTP ${res.status}`;
        } catch (e) { error = e instanceof Error ? e.message : String(e); }
        const at = nowIso(), ok = status >= 200 && status < 300, gone = status === 404 || status === 410;
        if (!ok) console.error('web push failed', note.eventType, status, host(s.endpoint), error);
        try {
          await env.db.update(webPushSubscriptions).set({ lastStatus: status, lastError: ok ? '' : error.slice(0, 500), lastAttemptAt: at, updatedAt: at,
            ...(ok ? { lastOkAt: at, lastSeenAt: at, failureCount: 0 } : { failureCount: sql`${webPushSubscriptions.failureCount} + 1` }),
            ...(gone ? { disabledAt: at } : {}) }).where(eq(webPushSubscriptions.id, s.id));
        } catch (e) { console.error('web push status update failed', e instanceof Error ? e.message : e); }
        return { subscriptionId: s.id, memberId: s.memberId, status, error };
      })));
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('web push dispatch failed', note.eventType, error);
    results.push({ subscriptionId: null, memberId: note.targetMemberId, status: 0, error });
  }
  await logAttempts(env, note.id, note.eventType, results);
  const sent = results.filter(r => r.status !== null && r.status >= 200 && r.status < 300).length;
  return { ok: true, sent, id: note.id, results };
}

/** Thông báo của một người: gửi đích danh, hoặc theo vai trò của họ. */
const mine = (m: { id: string; role: string }) => or(eq(webNotifications.targetMemberId, m.id),
  and(isNull(webNotifications.targetMemberId), or(eq(webNotifications.targetRole, 'all'), eq(webNotifications.targetRole, m.role))));

/** Recheck current permissions for persisted notes too; revocation must hide existing document previews. */
async function visibleNotes<T extends { eventType: string; url: string; dataJson: string }>(db: StaffEnv['db'], m: { id: string }, notes: T[]): Promise<T[]> {
  if (!notes.length) return [];
  const scope = await notificationScope(db);
  const checked = await boundedMap(notes,2,async n => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(n.dataJson); } catch { /* malformed legacy payload has no grants */ }
    return (await scope.recipients({ ...n, data }, [m.id])).length > 0;
  });
  return notes.filter((_, i) => checked[i]);
}

/** Thông báo mới nhất của người xem (cho GET /pulse – trình duyệt chỉ tải lại chuông khi giá trị này đổi). */
export async function latestNotificationAt(db: StaffEnv['db'], m: { id: string; role: string }): Promise<string> {
  // Pulse only carries a change timestamp, never document content. Keep this indexed aggregate cheap;
  // /notifications revalidates document authorization before returning any previews.
  const [r] = await db.select({ at: sql<string | null>`max(${webNotifications.createdAt})` }).from(webNotifications).where(mine(m));
  return r?.at ?? '';
}

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

  /** Gửi một thông báo thử tới mọi thiết bị đã bật thông báo của chính mình (tự kiểm tra máy có nhận push không). */
  router.post('/push/test', async c => {
    const me = (c.state.session as SessionState).member;
    const [d] = await c.env.db.select({ n: sql<number>`count(*)` }).from(webPushSubscriptions).where(and(eq(webPushSubscriptions.memberId, me.id), isNull(webPushSubscriptions.disabledAt)));
    const r = await notify(c.env, { eventType: 'push_test', title: 'Thông báo thử', body: 'Máy này đã nhận được thông báo đẩy từ Bách Ngân.', url: '/index.html', targetMemberId: me.id, actorId: me.id, persist: false, wait: true });
    const devs = r.results.some(x => x.subscriptionId) ? await c.env.db.select({ id: webPushSubscriptions.id, userAgent: webPushSubscriptions.userAgent }).from(webPushSubscriptions)
      .where(inArray(webPushSubscriptions.id, r.results.map(x => x.subscriptionId).filter((x): x is string => !!x))) : [];
    return json({ devices: Number(d?.n ?? 0), sent: r.sent,
      results: r.results.map(x => ({ device: deviceLabel(devs.find(v => v.id === x.subscriptionId)?.userAgent ?? ''), status: x.status, ok: x.status !== null && x.status >= 200 && x.status < 300, error: x.error })) });
  }, 'self');

  /**
   * Manager kiểm tra Web Push: máy chủ đã bật chưa, thiết bị của từng người (lần gửi gần nhất: mã trả về / lỗi),
   * và nhật ký gửi gần đây (`?member=<id>` lọc theo người nhận).
   */
  router.get('/push/devices', async c => {
    const me = (c.state.session as SessionState).member;
    if (me.role !== 'manager') throw new AppError(403, 'Chỉ Manager xem được trạng thái thông báo đẩy.');
    const member = clean(c.url.searchParams.get('member'), 80);
    const [keys] = await c.env.db.select({ id: webPushKeys.id }).from(webPushKeys).limit(1);
    const devices = await c.env.db.select({ s: webPushSubscriptions, name: employees.name, role: employees.role, active: employees.active }).from(webPushSubscriptions)
      .innerJoin(employees, eq(employees.id, webPushSubscriptions.memberId)).where(member ? eq(webPushSubscriptions.memberId, member) : undefined)
      .orderBy(asc(employees.name), desc(webPushSubscriptions.updatedAt)).limit(200);
    const attempts = await c.env.db.select({ a: webPushAttempts, name: employees.name }).from(webPushAttempts).leftJoin(employees, eq(employees.id, webPushAttempts.memberId))
      .where(member ? eq(webPushAttempts.memberId, member) : undefined).orderBy(desc(webPushAttempts.createdAt)).limit(100);
    return json({
      serverEnabled: (c.env.sapoSyncToken ?? '').length >= 32, keysCreated: !!keys,
      devices: devices.map(({ s, name, role, active }) => ({ id: s.id, memberId: s.memberId, name, role, memberActive: active, device: deviceLabel(s.userAgent), pushHost: host(s.endpoint),
        createdAt: s.createdAt, disabledAt: s.disabledAt, failureCount: s.failureCount, lastStatus: s.lastStatus, lastError: s.lastError, lastAttemptAt: s.lastAttemptAt, lastOkAt: s.lastOkAt })),
      attempts: attempts.map(({ a, name }) => ({ at: a.createdAt, eventType: a.eventType, memberId: a.memberId, name: name ?? '', subscriptionId: a.subscriptionId, status: a.status, error: a.error })),
    });
  }, 'business');

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
    const visible = new Set((await visibleNotes(c.env.db, me, rows.map(r => r.n))).map(n => n.id));
    const notifications = rows.filter(r => visible.has(r.n.id)).map(r => ({ id: r.n.id, eventType: r.n.eventType, title: r.n.title, body: r.n.body, url: r.n.url, createdAt: r.n.createdAt,
      actorName: r.actorName ?? '', readAt: r.readAt ?? null, data: (() => { try { return JSON.parse(r.n.dataJson); } catch { return {}; } })() }));
    return json({ notifications, unreadCount: notifications.filter(x => !x.readAt).length });
  }, 'self');

  router.post('/notifications/read', async c => {
    const me = (c.state.session as SessionState).member, b = await readJson(c.req, 8_000);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(x)).slice(0, 50) as string[] : [];
    const rows = b.all === true
      ? (await c.env.db.select().from(webNotifications).where(mine(me)).orderBy(desc(webNotifications.createdAt)).limit(100))
      : ids.length ? (await c.env.db.select().from(webNotifications).where(and(mine(me), inArray(webNotifications.id, ids)))) : [];
    const targets = (await visibleNotes(c.env.db, me, rows)).map(r => r.id);
    const at = nowIso();
    if (targets.length) await c.env.db.insert(webNotificationReads).values(targets.map(id=>({notificationId:id,memberId:me.id,readAt:at}))).onConflictDoNothing();
    return json({ ok: true, read: targets.length });
  }, 'self');
}
