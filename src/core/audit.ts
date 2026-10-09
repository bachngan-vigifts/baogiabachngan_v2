import type { AnyDb } from './db/client.ts';
import { auditLogs } from './db/schema.ts';

/**
 * NHẬT KÝ THAY ĐỔI (`audit_logs`): ai làm gì, lúc nào, trên bản ghi nào – để truy lại việc duyệt, sửa giá, huỷ đơn…
 * Ghi tự động cho mọi thao tác ghi thành công qua router (xem `staff/api/auth-routes.ts`), không đổi nghiệp vụ.
 * Không bao giờ làm hỏng thao tác chính: lỗi ghi nhật ký chỉ in ra log.
 */
export interface AuditEntry {
  actorId: string | null; module: string; action: string; entityType: string; entityId: string; data?: Record<string, unknown>;
}

/** Khoá có thể chứa bí mật hoặc dữ liệu nặng (ảnh, file) → không lưu nội dung. */
const SECRET_KEY = /pass(word)?|token|secret|cookie|otp|auth|session|key$/i;
const HEAVY_KEY = /photo|image|avatar|file|attachment|signature|base64|blob/i;
const MAX_STRING = 300, MAX_ITEMS = 30, MAX_JSON = 6_000;

/** Bản rút gọn, đã che bí mật của thân yêu cầu để lưu vào nhật ký. */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.startsWith('data:') ? '[dữ liệu file]' : value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (depth > 4) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map(v => sanitizeForAudit(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… (+${value.length - MAX_ITEMS})`] : items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[ẩn]' : HEAVY_KEY.test(k) && (typeof v === 'string' ? v.length > 200 : Array.isArray(v)) ? '[bỏ qua]' : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

const jsonOrNull = (text: string): unknown => { if (!text) return null; try { return JSON.parse(text); } catch { return null; } };

/** Ghi một dòng nhật ký. `data` được rút gọn còn tối đa ~6 KB. */
export async function writeAudit(db: AnyDb, e: AuditEntry): Promise<void> {
  try {
    let data = JSON.stringify(sanitizeForAudit(e.data ?? {}) ?? {});
    if (data.length > MAX_JSON) data = JSON.stringify({ truncated: true, preview: data.slice(0, MAX_JSON) });
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: e.actorId, module: e.module.slice(0, 40), action: e.action.slice(0, 120),
      entityType: e.entityType.slice(0, 60), entityId: e.entityId.slice(0, 120), data, createdAt: new Date().toISOString() });
  } catch (err) { console.error('audit write failed', e.action, err instanceof Error ? err.message : err); }
}

/**
 * Từ một thao tác ghi thành công của router → dòng nhật ký: loại bản ghi = đoạn đầu đường dẫn (quotes, orders, customers…),
 * mã bản ghi = tham số `:id` / `:sku` hoặc `id` trả về khi tạo mới; lưu thân yêu cầu đã che bí mật + mã trạng thái.
 */
export function auditFromRequest(input: { route: string; path: string; params: Record<string, string>; status: number; requestText: string; responseText: string }) {
  const [, first = '', second = ''] = input.path.split('/');
  const entityType = first === 'admin' ? `admin/${second}` : first;
  const response = jsonOrNull(input.responseText) as Record<string, unknown> | null;
  const entityId = input.params.id ?? input.params.sku ?? (typeof response?.id === 'string' ? response.id : '') ?? '';
  const body = jsonOrNull(input.requestText);
  const params = Object.fromEntries(Object.entries(input.params).filter(([k]) => k !== 'id' && k !== 'sku'));
  return { action: input.route, entityType, entityId: String(entityId), data: { ...(Object.keys(params).length ? { params } : {}), ...(body ? { body } : {}), status: input.status } };
}
