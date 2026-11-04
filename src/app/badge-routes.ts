import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import { writeGeneration } from '../core/http/write-generation.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';

/** Các số đếm huy hiệu menu / chuông có thể gộp; mỗi phần là đúng một API đọc đã có. */
const PARTS = {
  tasks: '/tasks/summary',
  navigation: '/navigation-counts',
  chat: '/chat/unread',
  care: '/care?view=follow-ups&limit=1',
  stock: '/stock-requests?status=open',
} as const;
type Part = keyof typeof PARTS;

/**
 * Cache rất ngắn cho lượt gọi trùng (nhiều tab / làm mới dồn dập) trong cùng phiên chạy Edge. Khoá gồm phiên đăng nhập,
 * toàn bộ hồ sơ nhân viên đã nạp cho yêu cầu này (vai trò, chức vụ, quyền, phạm vi…), các phần yêu cầu và số nấc lệnh ghi:
 * đổi quyền / đổi tài khoản / có thao tác ghi → khoá khác, đọc lại. Chỉ lưu khi mọi phần thành công (không cache lỗi).
 */
export const BADGE_TTL_MS = 5_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value?: unknown; pending?: Promise<{ value: unknown; ok: boolean }> }>();
export const clearBadgeCache = () => cache.clear();

/**
 * GỘP HUY HIỆU (GET /badges?parts=tasks,navigation,chat,care,stock): một lượt mạng thay cho 4–5 lượt mỗi khi trang làm mới.
 * Mỗi phần chạy lại đúng route gốc qua router (cùng phiên, cùng kiểm tra quyền / phạm vi dữ liệu) – không có đường đọc mới.
 * Phần bị từ chối hoặc lỗi trả `{ error, status }` riêng, không làm hỏng các phần khác.
 */
export function registerBadgeRoutes(router: Router<StaffEnv>, now: () => number = () => Date.now()) {
  router.get('/badges', async c => {
    const wanted = [...new Set((c.url.searchParams.get('parts') || '').split(','))].filter((k): k is Part => Object.hasOwn(PARTS, k)).sort();
    const session = c.state.session as SessionState;
    const key = JSON.stringify([session.tokenHash, session.member, wanted, writeGeneration()]);
    const t = now();
    for (const [k, e] of cache) if (!e.pending && t - e.at >= BADGE_TTL_MS) cache.delete(k);
    const hit = cache.get(key);
    if (hit?.pending) return json((await hit.pending).value);
    if (hit && t - hit.at < BADGE_TTL_MS) return json(hit.value);
    const headers = new Headers(c.req.headers);
    const pending = (async () => {
      const results = await Promise.all(wanted.map(async part => {
        const res = await router.handle(new Request(new URL('/api/staff' + PARTS[part], c.url.origin), { method: 'GET', headers }), c.env);
        return [part, res.ok ? await res.json() : { error: true, status: res.status }, res.ok] as const;
      }));
      return { value: { parts: Object.fromEntries(results.map(([part, body]) => [part, body])) }, ok: results.every(r => r[2]) };
    })();
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: t, pending });
    try {
      const result = await pending;
      if (result.ok) cache.set(key, { at: now(), value: result.value }); else cache.delete(key);
      return json(result.value);
    } catch (e) { cache.delete(key); throw e; }
  }, 'business');
}
