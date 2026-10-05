import type { TestD1 } from './d1.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { sha256Hex } from '../../src/modules/staff/domain/session.ts';
import { DEFAULT_POSITIONS } from '../../src/modules/staff/domain/members.ts';

export const PASSWORD = 'mat-khau-12345';
export const token = (n: number) => n.toString(16).padStart(64, '0');
export const T = { now: Math.floor(Date.now() / 1000) };

/**
 * Dữ liệu mồi dùng chung cho cả DB v2 và DB bản cũ (hai schema giống nhau ở các bảng staff_*), để chạy cùng một kịch bản.
 * Mật khẩu băm với 1.000 vòng cho nhanh (cả hai bản đọc số vòng từ chính chuỗi hash).
 */
export async function seedStaff(d1: TestD1) {
  const q = d1.sqlite;
  const pw = await hashPassword(PASSWORD, 1000);
  for (const { id, name } of DEFAULT_POSITIONS) q.prepare('INSERT OR IGNORE INTO staff_positions (id,name) VALUES (?,?)').run(id, name);
  const members: [string, string, string, string, number][] = [
    // id, email, role, positionId, active
    ['mgr', 'mgr@x.vn', 'manager', 'manager', 1], ['emp', 'emp@x.vn', 'employee', 'sale', 1], ['off', 'off@x.vn', 'employee', 'sale', 0],
    ['new', 'new@x.vn', 'employee', 'sale', 1], ['old', 'old@x.vn', 'employee', 'sale', 1], ['ncc', 'ncc@x.vn', 'supplier', 'supplier', 1],
  ];
  for (const [id, email, role, pos, active] of members) {
    q.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,?,?,?,?,'2026-01-01T00:00:00.000Z')").run(id, email, 'Tên ' + id, '0900000000', role, pos, active);
    const hasPw = !['new', 'old'].includes(id);
    q.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,?,?,0)').run(
      id, hasPw ? pw : null,
      id === 'new' ? sha256Hex(token(1)) : id === 'old' ? sha256Hex(token(2)) : null,
      id === 'new' ? T.now + 600 : id === 'old' ? T.now - 10 : null);
  }
}
