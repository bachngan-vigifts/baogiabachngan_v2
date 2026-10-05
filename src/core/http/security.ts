import { AppError } from '../errors.ts';

/**
 * Chống giả mạo yêu cầu (CSRF) – port từ staff-api.mjs: mọi yêu cầu KHÔNG phải GET phải đến từ chính trang web
 * (header Origin trùng origin của URL). Chỉ chấp nhận GET/POST/PUT/DELETE.
 */
export function checkMethodAndOrigin(req: Request, url: URL): void {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new AppError(405, 'Phương thức không hỗ trợ.');
  if (req.method !== 'GET' && req.headers.get('origin') !== url.origin) throw new AppError(403, 'Nguồn yêu cầu không hợp lệ.');
}
