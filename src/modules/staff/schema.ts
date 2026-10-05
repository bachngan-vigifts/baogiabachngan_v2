import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const positions = sqliteTable('staff_positions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
}, t => [uniqueIndex('idx_positions_name').on(t.name)]);
export const employees = sqliteTable('staff_members', {
  id: text('id').primaryKey(),
  identityId: text('identity_id'),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['employee', 'manager', 'supplier'] }).notNull().default('employee'),
  positionId: text('position_id').references(() => positions.id),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_members_email').on(t.email), uniqueIndex('idx_members_identity').on(t.identityId), index('idx_members_position').on(t.positionId)]);
export const credentials = sqliteTable('staff_credentials', {
  memberId: text('member_id').primaryKey().references(() => employees.id),
  passwordHash: text('password_hash'),
  activationHash: text('activation_hash'),
  activationExpires: integer('activation_expires'),
  version: integer('version').notNull().default(0),
});
export const sessions = sqliteTable('staff_sessions', {
  hash: text('hash').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  version: integer('version').notNull(),
  expires: integer('expires').notNull(),
}, t => [index('idx_sessions_member').on(t.memberId), index('idx_sessions_expires').on(t.expires)]);
export const authAttempts = sqliteTable('staff_auth_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expires: integer('expires').notNull(),
}, t => [index('idx_attempts_expires').on(t.expires)]);
export const setup = sqliteTable('staff_setup', { id: text('id').primaryKey() });
export const staffSapoLinks = sqliteTable('staff_sapo_links', {
 sapoId:text('sapo_id').primaryKey(),memberId:text('member_id').notNull().references(()=>employees.id),createdAt:text('created_at').notNull(),evidence:text('evidence').notNull(),
},t=>[uniqueIndex('idx_staff_sapo_member').on(t.memberId)]);
