/** Tin nhắn nội bộ giữa nhân viên: loại hội thoại và giới hạn (một chỗ để sửa). */
export const CHAT_KINDS = ['direct', 'group'] as const;
export type ChatKind = typeof CHAT_KINDS[number];
export const CHAT_LIMITS = { body: 4000, title: 120, groupMembers: 100, page: 80, files: 3, fileBytes: 6 * 1024 * 1024, search: 50 } as const;
/** Thu hồi tin nhắn: chỉ người gửi, trong vòng 4 giờ. */
export const RECALL_MS = 4 * 3600_000;
/** File đính kèm được nhận (theo đuôi file; bucket cũng chỉ nhận các loại này – migration 0038). */
export const CHAT_FILE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  csv: 'text/csv', txt: 'text/plain', // ZIP bỏ từ 07/11/2026: không kiểm được nội dung bên trong (file-sniff.ts)
};
/** Liên kết nhanh gửi trong tin (đơn hàng, HĐKT, báo giá, phiếu đóng gói, việc). */
export const CHAT_REF_TYPES = ['order', 'contract', 'quote', 'packing', 'task'] as const;
export type ChatRefType = typeof CHAT_REF_TYPES[number];
/** Khoá hội thoại 1-1: hai id xếp tăng dần → mỗi cặp nhân viên chỉ có một hội thoại. */
export const directKey = (a: string, b: string) => [a, b].sort().join('|');
