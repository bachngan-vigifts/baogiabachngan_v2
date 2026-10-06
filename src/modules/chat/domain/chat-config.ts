/** Tin nhắn nội bộ giữa nhân viên: loại hội thoại và giới hạn (một chỗ để sửa). */
export const CHAT_KINDS = ['direct', 'group'] as const;
export type ChatKind = typeof CHAT_KINDS[number];
export const CHAT_LIMITS = { body: 4000, title: 120, groupMembers: 100, page: 80 } as const;
/** Khoá hội thoại 1-1: hai id xếp tăng dần → mỗi cặp nhân viên chỉ có một hội thoại. */
export const directKey = (a: string, b: string) => [a, b].sort().join('|');
