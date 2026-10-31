/**
 * CHĂM SÓC KHÁCH HÀNG (nhật ký giao dịch kiểu CRM): mỗi lần nhân viên trao đổi với khách (gọi điện, Zalo, gặp mặt…) ghi một dòng
 * gồm hình thức, nội dung, kết quả và (tuỳ chọn) lịch hẹn chăm sóc tiếp. Lịch hẹn đến hạn tự thành việc ở "Công việc".
 *
 * Danh mục ở đây là chuẩn cho cả API, DB (CHECK) và giao diện (trial-ui/care.js đọc qua GET /care/config).
 * Thêm hình thức / kết quả mới = thêm một dòng ở CARE_TYPES / CARE_RESULTS + migration cập nhật CHECK.
 */
import { AppError } from '../../../core/errors.ts';

/** Loại giao dịch (như form CRM đang dùng: Gọi điện / Email / Gặp trực tiếp / Báo giá, thêm Zalo). */
export const CARE_TYPES = ['call', 'zalo', 'email', 'meeting', 'quote'] as const;
/** Kết quả = giai đoạn của giao dịch. */
export const CARE_RESULTS = ['consulting', 'quote_sent', 'negotiating', 'won', 'lost'] as const;
/** Nhắc tôi trước ngày chăm sóc lần sau: 1 ngày / 1 tuần / 1 tháng (số ngày ở REMIND_DAYS). */
export const CARE_REMIND = ['1d', '1w', '1m'] as const;
export type CareType = typeof CARE_TYPES[number];
export type CareResult = typeof CARE_RESULTS[number];
export type CareRemind = typeof CARE_REMIND[number];

export const CARE_TYPE_LABEL: Record<CareType, string> = { call: 'Gọi điện thoại', zalo: 'Zalo', email: 'Email', meeting: 'Gặp trực tiếp', quote: 'Báo giá' };
export const CARE_RESULT_LABEL: Record<CareResult, string> = {
  consulting: 'Đang tư vấn', quote_sent: 'Đã gửi báo giá', negotiating: 'Đang thương lượng', won: 'Đã chốt HĐ', lost: 'Đã rớt đơn',
};
export const CARE_REMIND_LABEL: Record<CareRemind, string> = { '1m': '1 Tháng', '1w': '1 Tuần', '1d': '1 Ngày' };
export const REMIND_DAYS: Record<CareRemind, number> = { '1d': 1, '1w': 7, '1m': 30 };

/** Giới hạn độ dài từng trường (ký tự). */
export const CARE_LIMITS = { subject: 200, content: 2000, contactName: 160, nextAction: 300 } as const;
export const MAX_EXPECTED_REVENUE = 1e12;

/** Dữ liệu một lần chăm sóc sau khi kiểm tra (chưa gồm id, người ghi, thời điểm lưu). */
export interface CareInput {
  customerId: string; type: CareType; result: CareResult; occurredAt: string; contactName: string;
  subject: string; content: string; nextAt: string | null; nextAction: string; remindBefore: CareRemind; expectedRevenue: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message: string) => new AppError(400, message);
const str = (v: unknown, field: string, max: number) => {
  if (v !== undefined && v !== null && typeof v !== 'string') throw bad(`${field} không hợp lệ.`);
  const s = String(v ?? '').trim();
  if (s.length > max) throw bad(`${field} tối đa ${max} ký tự.`);
  return s;
};
const validDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/**
 * Kiểm tra & chuẩn hoá dữ liệu nhập (form như CRM đang dùng). `today` = ngày hiện tại (YYYY-MM-DD, giờ Việt Nam).
 * Bắt buộc: khách hàng, người liên hệ, nội dung, loại giao dịch, kết quả, nhắc trước. Form có completion cho phép bỏ hẹn tiếp; client cũ giữ yêu cầu cũ.
 * - Thời gian tạo: ngày (YYYY-MM-DD) hoặc ISO đầy đủ; không ở tương lai, không quá 2 năm trước. Mặc định hôm nay.
 * - Chăm sóc lần sau: từ hôm nay trở đi. Doanh số dự kiến: số ≥ 0 (đồng), tuỳ chọn.
 */
export function cleanCare(raw: Record<string, unknown>, today: string, now = new Date()): CareInput {
  const customerId = str(raw.customerId, 'Khách hàng', 100);
  if (!customerId) throw bad('Chọn khách hàng.');
  const contactName = str(raw.contactName, 'Người liên hệ', CARE_LIMITS.contactName);
  if (!contactName) throw bad('Chọn người liên hệ.');
  const subject = str(raw.subject, 'Tiêu đề', CARE_LIMITS.subject), content = str(raw.content, 'Nội dung', CARE_LIMITS.content);
  if (!subject && !content) throw bad('Nhập nội dung.');
  const type = String(raw.type ?? '') as CareType, result = String(raw.result ?? '') as CareResult, remindBefore = String(raw.remindBefore ?? '') as CareRemind;
  if (!(CARE_TYPES as readonly string[]).includes(type)) throw bad('Chọn loại giao dịch.');
  if (!(CARE_RESULTS as readonly string[]).includes(result)) throw bad('Chọn kết quả.');
  if (!(CARE_REMIND as readonly string[]).includes(remindBefore)) throw bad('Chọn nhắc tôi trước 1 tháng / 1 tuần / 1 ngày.');
  const occurredRaw = str(raw.occurredAt, 'Thời gian tạo', 40);
  const occurred = !occurredRaw ? now : validDate(occurredRaw) ? new Date(Date.parse(occurredRaw + 'T00:00:00+07:00') + 12 * 3_600_000) : new Date(occurredRaw);
  if (Number.isNaN(occurred.getTime())) throw bad('Thời gian tạo không hợp lệ.');
  if (occurred.getTime() > now.getTime() + 86_400_000) throw bad('Thời gian tạo không được ở tương lai.');
  if (occurred.getTime() < now.getTime() - 2 * 365 * 86_400_000) throw bad('Thời gian tạo quá xa (tối đa 2 năm trước).');
  if(raw.completion!==undefined&&new Date(occurred.getTime()+7*3600_000).toISOString().slice(0,10)>today)throw bad('Giao dịch thực tế không được ở ngày tương lai.');
  const nextRaw = str(raw.nextAt, 'Chăm sóc lần sau', 10), nextAction = str(raw.nextAction, 'Việc hẹn', CARE_LIMITS.nextAction);
  if (!nextRaw&&raw.completion===undefined) throw bad('Chọn ngày chăm sóc lần sau.');
  if (nextRaw&&!validDate(nextRaw)) throw bad('Ngày chăm sóc lần sau không hợp lệ.');
  if (nextRaw&&nextRaw < today) throw bad('Ngày chăm sóc lần sau phải từ hôm nay trở đi.');
  const rev = raw.expectedRevenue === undefined || raw.expectedRevenue === null || raw.expectedRevenue === '' ? 0 : Number(raw.expectedRevenue);
  if (!Number.isFinite(rev) || rev < 0 || rev > MAX_EXPECTED_REVENUE) throw bad('Doanh số dự kiến không hợp lệ.');
  return { customerId, type, result, occurredAt: occurred.toISOString(), contactName, subject, content, nextAt: nextRaw||null, nextAction, remindBefore, expectedRevenue: Math.round(rev) };
}

/** Ngày bắt đầu nhắc (YYYY-MM-DD) = ngày chăm sóc lần sau − số ngày "nhắc trước". */
export const remindFrom = (nextAt: string, remind: CareRemind) => new Date(Date.parse(nextAt + 'T00:00:00Z') - REMIND_DAYS[remind] * 86_400_000).toISOString().slice(0, 10);

/** Trạng thái lịch hẹn: không hẹn / đã xong / quá hạn / hôm nay / sắp tới. */
export function followUpState(nextAt: string | null, doneAt: string | null, today: string): 'none' | 'done' | 'overdue' | 'today' | 'upcoming' {
  if (!nextAt) return 'none';
  if (doneAt) return 'done';
  return nextAt < today ? 'overdue' : nextAt === today ? 'today' : 'upcoming';
}
