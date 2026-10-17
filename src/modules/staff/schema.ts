import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

/** Phòng ban (Kinh doanh, Kho, Kế toán…): nhóm các chức vụ – docs/PHAN-QUYEN.md. */
export const departments = pgTable('staff_departments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_departments_name').on(t.name)]).enableRLS();
export const positions = pgTable('staff_positions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Phòng ban của chức vụ (null = chưa xếp phòng). */
  departmentId: text('department_id').references(() => departments.id, { onDelete: 'set null' }),
  /** Phạm vi dữ liệu người giữ chức vụ được xem: own | position | department | all (domain/permissions.ts). */
  dataScope: text('data_scope', { enum: ['own', 'position', 'department', 'all'] }).notNull().default('position'),
}, t => [uniqueIndex('idx_positions_name').on(t.name), index('idx_positions_department').on(t.departmentId)]).enableRLS();
/** Quyền của từng chức vụ (khoá trong PERMISSIONS – domain/permissions.ts). Có dòng = được phép. */
export const positionPermissions = pgTable('staff_position_permissions', {
  positionId: text('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
}, t => [primaryKey({ columns: [t.positionId, t.permission] })]).enableRLS();
export const employees = pgTable('staff_members', {
  id: text('id').primaryKey(),
  identityId: text('identity_id'),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['employee', 'manager', 'supplier', 'customer'] }).notNull().default('employee'),
  positionId: text('position_id').references(() => positions.id),
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
  /** Đã xoá khỏi danh sách nhân viên (giữ dòng để lịch sử báo giá / đơn vẫn hiện đúng tên). */
  deletedAt: text('deleted_at'),
  /** Mã ảnh đại diện hiện tại (đổi mỗi lần tải ảnh mới → trình duyệt tự lấy ảnh mới); null = dùng chữ viết tắt. */
  avatarKey: text('avatar_key'),
  /** Được Manager chỉ định phê duyệt (báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC). Chỉ Manager bật / tắt – docs/PHAN-QUYEN.md. */
  canApprove: boolean('can_approve').notNull().default(false),
}, t => [uniqueIndex('idx_members_email').on(sql`lower(${t.email})`), uniqueIndex('idx_members_identity').on(t.identityId), index('idx_members_position').on(t.positionId)]).enableRLS();
export const credentials = pgTable('staff_credentials', {
  memberId: text('member_id').primaryKey().references(() => employees.id),
  passwordHash: text('password_hash'),
  activationHash: text('activation_hash'),
  activationExpires: bigint('activation_expires', { mode: 'number' }),
  version: bigint('version', { mode: 'number' }).notNull().default(0),
}).enableRLS();
export const sessions = pgTable('staff_sessions', {
  hash: text('hash').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  version: bigint('version', { mode: 'number' }).notNull(),
  expires: bigint('expires', { mode: 'number' }).notNull(),
}, t => [index('idx_sessions_member').on(t.memberId), index('idx_sessions_expires').on(t.expires)]).enableRLS();
export const authAttempts = pgTable('staff_auth_attempts', {
  key: text('key').primaryKey(),
  count: bigint('count', { mode: 'number' }).notNull(),
  expires: bigint('expires', { mode: 'number' }).notNull(),
}, t => [index('idx_attempts_expires').on(t.expires)]).enableRLS();
export const setup = pgTable('staff_setup', { id: text('id').primaryKey() }).enableRLS();
export const staffSapoLinks = pgTable('staff_sapo_links', {
 sapoId:text('sapo_id').primaryKey(),memberId:text('member_id').notNull().references(()=>employees.id),createdAt:text('created_at').notNull(),evidence:text('evidence').notNull(),
},t=>[uniqueIndex('idx_staff_sapo_member').on(t.memberId)]).enableRLS();
/** Ảnh đại diện nhân viên (đã thu nhỏ ở trình duyệt, ~10 KB): một ảnh / người, `key` khớp `staff_members.avatar_key`. */
export const staffAvatars = pgTable('staff_avatars', {
  memberId: text('member_id').primaryKey().references(() => employees.id),
  key: text('key').notNull(),
  dataUrl: text('data_url').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('idx_staff_avatars_key').on(t.key)]).enableRLS();
/** Nhật ký thay đổi phân quyền: ai sửa, lúc nào, sửa gì (chữ mô tả). */
export const permissionLog = pgTable('staff_permission_log', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  by: text('by').notNull().references(() => employees.id),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
}, t => [index('idx_permission_log_at').on(t.at)]).enableRLS();
