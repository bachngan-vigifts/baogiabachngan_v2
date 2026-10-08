/**
 * CHĂM SÓC KHÁCH HÀNG (nhật ký giao dịch kiểu CRM): mỗi lần nhân viên trao đổi với khách (gọi điện, Zalo, gặp mặt…) ghi một dòng
 * gồm hình thức, nội dung, kết quả và (tuỳ chọn) lịch hẹn chăm sóc tiếp. Lịch hẹn đến hạn tự thành việc ở "Công việc".
 *
 * Danh mục ở đây là chuẩn cho cả API, DB (CHECK) và giao diện (trial-ui/care.js đọc qua GET /care/config).
 * Thêm hình thức / kết quả mới = thêm một dòng ở CARE_TYPES / CARE_RESULTS + migration cập nhật CHECK.
 */
import { AppError } from '../../../core/errors.ts';

export const CARE_TYPES = ['call', 'zalo', 'meeting', 'visit', 'email', 'sms', 'note'] as const;
export const CARE_RESULTS = ['none', 'interested', 'quote_requested', 'ordered', 'follow_up', 'no_answer', 'not_interested', 'complaint'] as const;
export type CareType = typeof CARE_TYPES[number];
export type CareResult = typeof CARE_RESULTS[number];

export const CARE_TYPE_LABEL: Record<CareType, string> = {
  call: 'Gọi điện', zalo: 'Zalo / chat', meeting: 'Gặp mặt', visit: 'Đến thăm', email: 'Email', sms: 'Tin nhắn SMS', note: 'Ghi chú',
};
export const CARE_RESULT_LABEL: Record<CareResult, string> = {
  none: 'Chưa có kết quả', interested: 'Quan tâm', quote_requested: 'Cần báo giá', ordered: 'Đã chốt đơn', follow_up: 'Hẹn trao đổi lại',
  no_answer: 'Không liên lạc được', not_interested: 'Không có nhu cầu', complaint: 'Khiếu nại / góp ý',
};

/** Giới hạn độ dài từng trường (ký tự). */
export const CARE_LIMITS = { subject: 200, content: 4000, contactName: 120, nextAction: 300 } as const;

/** Dữ liệu một lần chăm sóc sau khi kiểm tra (chưa gồm id, người ghi, thời điểm lưu). */
export interface CareInput {
  customerId: string; type: CareType; result: CareResult; occurredAt: string; contactName: string;
  subject: string; content: string; nextAt: string | null; nextAction: string;
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
 * Kiểm tra & chuẩn hoá dữ liệu nhập. `today` = ngày hiện tại (YYYY-MM-DD, giờ Việt Nam).
 * - Thời điểm trao đổi: ISO đầy đủ, không quá 1 ngày trong tương lai, không quá 2 năm về trước.
 * - Hẹn chăm sóc tiếp: ngày (YYYY-MM-DD) từ hôm nay trở đi; có hẹn thì phải ghi việc cần làm hoặc nội dung.
 */
export function cleanCare(raw: Record<string, unknown>, today: string, now = new Date()): CareInput {
  const customerId = str(raw.customerId, 'Khách hàng', 100);
  if (!customerId) throw bad('Chọn khách hàng.');
  const type = String(raw.type ?? '') as CareType, result = String(raw.result ?? 'none') as CareResult;
  if (!(CARE_TYPES as readonly string[]).includes(type)) throw bad('Chọn hình thức chăm sóc.');
  if (!(CARE_RESULTS as readonly string[]).includes(result)) throw bad('Kết quả không hợp lệ.');
  const subject = str(raw.subject, 'Tiêu đề', CARE_LIMITS.subject), content = str(raw.content, 'Nội dung', CARE_LIMITS.content);
  if (!subject && !content) throw bad('Nhập tiêu đề hoặc nội dung trao đổi.');
  const occurredRaw = str(raw.occurredAt, 'Thời điểm', 40), occurred = occurredRaw ? new Date(occurredRaw) : now;
  if (Number.isNaN(occurred.getTime())) throw bad('Thời điểm trao đổi không hợp lệ.');
  if (occurred.getTime() > now.getTime() + 86_400_000) throw bad('Thời điểm trao đổi không được ở tương lai.');
  if (occurred.getTime() < now.getTime() - 2 * 365 * 86_400_000) throw bad('Thời điểm trao đổi quá xa (tối đa 2 năm trước).');
  const nextRaw = str(raw.nextAt, 'Ngày hẹn', 10), nextAction = str(raw.nextAction, 'Việc hẹn', CARE_LIMITS.nextAction);
  if (nextRaw && !validDate(nextRaw)) throw bad('Ngày hẹn chăm sóc tiếp không hợp lệ.');
  if (nextRaw && nextRaw < today) throw bad('Ngày hẹn chăm sóc tiếp phải từ hôm nay trở đi.');
  if (!nextRaw && nextAction) throw bad('Chọn ngày hẹn cho việc chăm sóc tiếp.');
  return { customerId, type, result, occurredAt: occurred.toISOString(), contactName: str(raw.contactName, 'Người liên hệ', CARE_LIMITS.contactName),
    subject, content, nextAt: nextRaw || null, nextAction };
}

/** Trạng thái lịch hẹn: không hẹn / đã xong / quá hạn / hôm nay / sắp tới. */
export function followUpState(nextAt: string | null, doneAt: string | null, today: string): 'none' | 'done' | 'overdue' | 'today' | 'upcoming' {
  if (!nextAt) return 'none';
  if (doneAt) return 'done';
  return nextAt < today ? 'overdue' : nextAt === today ? 'today' : 'upcoming';
}
