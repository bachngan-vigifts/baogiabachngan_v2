/**
 * CHỐNG TRÙNG KHÁCH THEO MÃ SỐ THUẾ.
 * MST so sánh sau khi bỏ khoảng trắng / dấu chấm, chữ hoa; giữ dấu gạch (chi nhánh "0312345678-001" là MST khác).
 * MST rỗng không tính trùng (khách lẻ).
 */
export const normTaxCode = (x: string | null | undefined) => String(x ?? '').replace(/[\s.]/g, '').toUpperCase();

/** Biểu thức SQL tương ứng `normTaxCode` (dùng với cột tax_code). */
export const NORM_TAX_SQL = (column: string) => `upper(regexp_replace(${column}, '[[:space:].]', '', 'g'))`;

export interface DuplicateCandidate {
  id: string; name: string; contact: string; phone: string; email: string; address: string; createdAt: string;
  contacts: number; refs: number; hasOwner: boolean;
}

/**
 * Chọn khách GIỮ LẠI trong một nhóm trùng MST:
 *  1) có người liên hệ (ô Người liên hệ hoặc danh sách người liên hệ) — bản thiếu người liên hệ bị xoá;
 *  2) nhiều chứng từ / lịch sử gắn với khách hơn (đơn, HĐKT, báo giá, chăm sóc…);
 *  3) có người phụ trách; 4) nhiều thông tin hơn; 5) tạo trước.
 */
export function pickKeeper<T extends DuplicateCandidate>(group: T[]): T {
  const filled = (c: T) => [c.contact, c.phone, c.email, c.address].filter(v => v && v.trim()).length;
  const score = (c: T) => [Number(!!c.contact.trim() || c.contacts > 0), c.refs, Number(c.hasOwner), filled(c) + c.contacts];
  return [...group].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i]! - sa[i]!;
    return (a.createdAt || '9999').localeCompare(b.createdAt || '9999') || a.id.localeCompare(b.id);
  })[0]!;
}
