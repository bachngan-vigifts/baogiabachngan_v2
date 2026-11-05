/** Góp ý phát triển phần mềm: loại, mức ảnh hưởng, trạng thái xử lý (hàm thuần, dùng chung API / test). */
export const FEEDBACK_KINDS = ['bug', 'feature', 'ui', 'other'] as const;
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Báo lỗi', feature: 'Đề xuất tính năng mới', ui: 'Cải thiện giao diện', other: 'Khác' };
export const FEEDBACK_IMPACTS = ['low', 'medium', 'high', 'blocking'] as const;
export const FEEDBACK_IMPACT_LABEL: Record<FeedbackImpact, string> = { low: 'Thấp', medium: 'Vừa', high: 'Cao', blocking: 'Chặn công việc' };
export const FEEDBACK_STATUSES = ['new', 'reviewing', 'planned', 'in_progress', 'done', 'wont_do', 'duplicate'] as const;
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Mới', reviewing: 'Đang xem xét', planned: 'Đã lên kế hoạch', in_progress: 'Đang làm', done: 'Đã xong', wont_do: 'Không làm', duplicate: 'Trùng góp ý khác',
};
export const FEEDBACK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const FEEDBACK_PRIORITY_LABEL: Record<FeedbackPriority, string> = { low: 'Thấp', medium: 'Vừa', high: 'Cao', urgent: 'Gấp' };
export const FEEDBACK_VISIBILITIES = ['public', 'private'] as const;
export type FeedbackKind = typeof FEEDBACK_KINDS[number];
export type FeedbackImpact = typeof FEEDBACK_IMPACTS[number];
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];
export type FeedbackPriority = typeof FEEDBACK_PRIORITIES[number];
export type FeedbackVisibility = typeof FEEDBACK_VISIBILITIES[number];
/** Đã đóng: không nhận +1, không mở lại bằng bình luận. */
export const FEEDBACK_CLOSED: readonly FeedbackStatus[] = ['done', 'wont_do', 'duplicate'];
export const FEEDBACK_LIMITS = { title: 160, description: 4000, steps: 2000, comment: 2000, reason: 500, pageUrl: 500, clientInfo: 500, photos: 3, photoChars: 800_000, perHour: 10, pageSize: 30 } as const;

/** Ai xem được: người gửi, người xử lý; góp ý công khai thì mọi nhân viên. */
export const canSeeFeedback = (f: { visibility: string; createdBy: string }, me: string, manage: boolean) => manage || f.createdBy === me || f.visibility === 'public';

/** Mã hiển thị: GY-0001. */
export const feedbackCode = (n: number) => 'GY-' + String(n).padStart(4, '0');
