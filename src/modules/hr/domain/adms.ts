import { AppError } from '../../../core/errors.ts';

export interface AdmsConfig { url: string; companyId: number; token: string; fetch?: typeof fetch }
export interface AdmsLog {
  companyId: number; logId: string; empCode: string; fullName: string; checkTime: string;
  punchState: number; deviceSerial: string; source: string;
}
export const ADMS_PAGE_SIZE = 200;
const maxLogs = 5000;
const badData = () => new AppError(502, 'Dữ liệu ADMS không hợp lệ. Chưa lưu lượt chấm công nào.');
export function admsDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
}
export function admsRange(from: unknown, to: unknown) {
  if (!admsDate(from) || !admsDate(to) || from > to || +new Date(to) - +new Date(from) > 30 * 864e5)
    throw new AppError(400, 'Chọn khoảng ngày hợp lệ, tối đa 31 ngày.');
  return { from, to };
}
export function admsCode(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 100 || /[\x00-\x1f]/.test(v))
    throw new AppError(400, 'Mã nhân viên máy chấm công không hợp lệ.');
  return v.trim();
}
export function admsConfig(config?: AdmsConfig): AdmsConfig {
  if (!config?.url || !Number.isSafeInteger(config.companyId) || config.companyId <= 0 || config.token.length < 32)
    throw new AppError(503, 'Chưa cấu hình kết nối ADMS. Cần địa chỉ API, company_id và mã kết nối phía máy chủ.');
  let url: URL;
  try { url = new URL(config.url); } catch { throw new AppError(503, 'Địa chỉ API ADMS chưa hợp lệ.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new AppError(503, 'API ADMS phải dùng HTTPS và không chứa tài khoản hoặc tham số trong địa chỉ.');
  return config;
}
function stringField(v: unknown, max: number) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' || v.length > max) throw badData();
  return v;
}
function parseLog(raw: unknown, companyId: number, from: string, to: string): AdmsLog {
  if (!raw || typeof raw !== 'object') throw badData();
  const r = raw as Record<string, unknown>;
  if (!['string', 'number'].includes(typeof r.log_id) || !/^\d{1,64}$/.test(String(r.log_id)) ||
      (typeof r.log_id === 'number' && !Number.isSafeInteger(r.log_id)) || Number(r.company_id) !== companyId) throw badData();
  const time = r.check_time;
  if (typeof time !== 'string' || !/^20\d{2}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time) ||
      !admsDate(time.slice(0, 10)) || time < from + ' 00:00:00' || time > to + ' 23:59:59') throw badData();
  const state = r.punch_state === null ? 255 : r.punch_state;
  if (state === '' || !['string', 'number'].includes(typeof state) || !/^\d{1,3}$/.test(String(state)) || Number(state) > 255) throw badData();
  let code: string;
  try { code = admsCode(r.emp_code); } catch { throw badData(); }
  return { companyId, logId: String(r.log_id), empCode: code, fullName: stringField(r.full_name, 300), checkTime: time,
    punchState: Number(state), deviceSerial: stringField(r.device_serial, 100), source: stringField(r.source, 100) };
}
/** Đọc đầy đủ phân trang trước khi ghi DB; lỗi / vượt giới hạn không được báo thành công một phần. */
export async function fetchAdmsLogs(config: AdmsConfig, from: string, to: string): Promise<AdmsLog[]> {
  admsConfig(config); admsRange(from, to);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25_000);
  const rows: AdmsLog[] = [], ids = new Set<string>();
  let total: number | undefined;
  try {
    for (let page = 1; ; page++) {
      const url = new URL(config.url);
      url.search = new URLSearchParams({ company_id: String(config.companyId), from_date: from + ' 00:00:00',
        to_date: to + ' 23:59:59', limit: String(ADMS_PAGE_SIZE), page: String(page) }).toString();
      const response = await (config.fetch ?? fetch)(url, { headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/json' },
        redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new AppError(502, response.status === 401 || response.status === 403
        ? 'ADMS từ chối mã kết nối. Chưa lưu lượt chấm công nào.' : 'Không đọc được dữ liệu ADMS. Chưa lưu lượt chấm công nào.');
      // Đọc có giới hạn, kể cả khi máy chủ không gửi Content-Length.
      const reader = response.body?.getReader(); if (!reader) throw badData();
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw badData(); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      if (body.status !== 'success' || !Array.isArray(body.data) || !Number.isSafeInteger(body.total) || Number(body.total) < 0 ||
          Number(body.page) !== page || Number(body.limit) !== ADMS_PAGE_SIZE) throw badData();
      if (Number(body.total) > maxLogs) throw new AppError(400, 'Khoảng ngày có hơn 5.000 lượt. Chọn khoảng ngắn hơn rồi đồng bộ lại.');
      if (total !== undefined && total !== body.total) throw new AppError(409, 'Dữ liệu ADMS thay đổi khi đang đọc. Đồng bộ lại khoảng ngày này.');
      total = Number(body.total);
      if (body.data.length !== Math.min(ADMS_PAGE_SIZE, total - rows.length)) throw badData();
      for (const raw of body.data) { const row = parseLog(raw, config.companyId, from, to);
        if (ids.has(row.logId)) throw badData(); ids.add(row.logId); rows.push(row); }
      if (rows.length === total) return rows;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Không chuyển tiếp URL, token, lỗi SQL hoặc nội dung máy chủ ADMS ra trình duyệt.
    throw new AppError(502, 'Không kết nối hoặc đọc được dữ liệu ADMS. Chưa lưu lượt chấm công nào.');
  } finally { clearTimeout(timer); }
}
