import { DAILY_CHECKLIST } from '../../src/modules/store/domain/reports.ts';
/** Phần bắt buộc của báo cáo ngày CHT (checklist cuối ngày + sự cố) – dùng khi test nộp chính thức báo cáo ngày. */
export const DAILY_DONE = { checklist: Object.fromEntries(DAILY_CHECKLIST.map(i => [i.key, 'yes'])), incidentTypes: ['none'] };
