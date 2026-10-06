import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const positions = pgTable('staff_positions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
}, t => [uniqueIndex('idx_positions_name').on(t.name)]).enableRLS();
export const employees = pgTable('staff_members', {
  id: text('id').primaryKey(),
  identityId: text('identity_id'),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['employee', 'manager', 'supplier'] }).notNull().default('employee'),
  positionId: text('position_id').references(() => positions.id),
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
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
