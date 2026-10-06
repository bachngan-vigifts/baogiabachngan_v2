import { activationLink, memberRole, newMemberId } from './members.ts';
import { newToken, sha256Hex } from './session.ts';

/**
 * Tạo Manager đầu tiên khi DB còn trống (bản cũ nạp danh sách nhân viên thật ngay trong mã nguồn – bản mới thì không).
 * Trả về các câu SQL để chạy bằng `Supabase SQL Editor` và liên kết kích hoạt để gửi cho người đó.
 * Liên kết hiệu lực `ttlSeconds` (mặc định 24 giờ vì được phát tay, không phải bấm ngay như liên kết tạo trên trang quản lý).
 */
export const sqlLiteral = (v: string | number): string => typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;

export interface BootstrapInput { name: string; email: string; phone: string; origin: string; nowSec: number; ttlSeconds?: number; token?: string; id?: string }
export function buildManagerBootstrap(i: BootstrapInput): { sql: string[]; url: string; id: string } {
  const name = i.name.trim(), email = i.email.trim().toLowerCase(), phone = i.phone.trim();
  if (!name || name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || phone.length > 40) throw new Error('Cần họ tên, email hợp lệ và số điện thoại (tối đa 40 ký tự).');
  const id = i.id ?? newMemberId(), token = i.token ?? newToken(), expires = i.nowSec + (i.ttlSeconds ?? 24 * 3600);
  const q = sqlLiteral;
  return {
    id, url: activationLink(i.origin, email, token),
    sql: [
      `INSERT INTO staff_members (id,email,name,role,position_id,active,created_at,phone) VALUES (${q(id)},${q(email)},${q(name)},${q(memberRole('manager'))},'manager',true,${q(new Date(i.nowSec * 1000).toISOString())},${q(phone)});`,
      `INSERT INTO staff_credentials (member_id,activation_hash,activation_expires,version) VALUES (${q(id)},${q(sha256Hex(token))},${expires},0);`,
    ],
  };
}
