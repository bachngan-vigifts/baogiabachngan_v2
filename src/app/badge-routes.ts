import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import type { StaffEnv } from '../modules/staff/api/auth-routes.ts';

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
 * GỘP HUY HIỆU (GET /badges?parts=tasks,navigation,chat,care,stock): một lượt mạng thay cho 4–5 lượt mỗi khi trang làm mới.
 * Mỗi phần chạy lại đúng route gốc qua router (cùng phiên, cùng kiểm tra quyền / phạm vi dữ liệu) – không có đường đọc mới.
 * Phần bị từ chối hoặc lỗi trả `{ error, status }` riêng, không làm hỏng các phần khác.
 */
export function registerBadgeRoutes(router: Router<StaffEnv>) {
  router.get('/badges', async c => {
    const wanted = [...new Set((c.url.searchParams.get('parts') || '').split(','))].filter((k): k is Part => Object.hasOwn(PARTS, k));
    const headers = new Headers(c.req.headers);
    const results = await Promise.all(wanted.map(async part => {
      const res = await router.handle(new Request(new URL('/api/staff' + PARTS[part], c.url.origin), { method: 'GET', headers }), c.env);
      return [part, res.ok ? await res.json() : { error: true, status: res.status }] as const;
    }));
    return json({ parts: Object.fromEntries(results) });
  }, 'business');
}
