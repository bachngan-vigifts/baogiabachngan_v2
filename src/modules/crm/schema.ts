import { pgTable, text, bigint, boolean, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const crmTasks = pgTable('crm_tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  details: text('details').notNull().default(''),
  customerId: text('customer_id'),
  quoteNumber: text('quote_number'),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  dueDate: text('due_date'),
  assignedTo: text('assigned_to').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, t => [index('idx_crm_tasks_assignee_status').on(t.assignedTo,t.status), index('idx_crm_tasks_due_date').on(t.dueDate)]).enableRLS();
export const vigiftsApps = pgTable('vigifts_appsheet_apps', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceAppId: text('source_app_id').notNull(),
  sourceVersion: text('source_version').notNull().default(''),
  appDefinitionJson: text('app_definition_json').notNull(),
  exportedAt: text('exported_at').notNull(),
  importedAt: text('imported_at').notNull(),
}).enableRLS();
export const vigiftsTables = pgTable('vigifts_appsheet_tables', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  tableName: text('table_name').notNull(),
  safeName: text('safe_name').notNull(),
  baseId: text('base_id').notNull(),
  frameId: text('frame_id').notNull(),
  schemaName: text('schema_name').notNull(),
  updateMode: bigint('update_mode', { mode: 'number' }).notNull().default(0),
  allowedUpdates: bigint('allowed_updates', { mode: 'number' }).notNull().default(0),
  sourceJson: text('source_json').notNull().default('{}'),
}, t => [
  primaryKey({columns:[t.appId,t.tableName]}),
  uniqueIndex('idx_vigifts_tables_frame').on(t.appId,t.frameId),
  index('idx_vigifts_tables_safe').on(t.safeName),
]).enableRLS();
export const vigiftsFields = pgTable('vigifts_appsheet_fields', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  tableName: text('table_name').notNull(),
  fieldId: text('field_id').notNull(),
  fieldName: text('field_name').notNull(),
  fieldType: text('field_type').notNull().default(''),
  ordinal: bigint('ordinal', { mode: 'number' }).notNull().default(0),
  isKey: boolean('is_key').notNull().default(false),
  isLabel: boolean('is_label').notNull().default(false),
  isRequired: boolean('is_required').notNull().default(false),
  isHidden: boolean('is_hidden').notNull().default(false),
  isVirtual: boolean('is_virtual').notNull().default(false),
  expressionJson: text('expression_json').notNull().default('{}'),
  fieldJson: text('field_json').notNull().default('{}'),
}, t => [
  primaryKey({columns:[t.appId,t.tableName,t.fieldId]}),
  index('idx_vigifts_fields_name').on(t.appId,t.tableName,t.fieldName),
]).enableRLS();
export const vigiftsRows = pgTable('vigifts_appsheet_rows', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  tableName: text('table_name').notNull(),
  tupleId: text('tuple_id').notNull(),
  valuesJson: text('values_json').notNull(),
  rawJson: text('raw_json').notNull().default('{}'),
  searchText: text('search_text').notNull().default(''),
  sourceCreatedAt: text('source_created_at'),
  sourceUpdatedAt: text('source_updated_at'),
  importedAt: text('imported_at').notNull(),
}, t => [
  primaryKey({columns:[t.appId,t.tableName,t.tupleId]}),
  index('idx_vigifts_rows_table').on(t.appId,t.tableName),
  index('idx_vigifts_rows_search').on(t.searchText),
]).enableRLS();
export const vigiftsViews = pgTable('vigifts_appsheet_views', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  viewName: text('view_name').notNull(),
  displayName: text('display_name').notNull().default(''),
  position: text('position').notNull().default(''),
  tableName: text('table_name').notNull().default(''),
  action: text('action').notNull().default(''),
  actionType: text('action_type').notNull().default(''),
  order: bigint('view_order', { mode: 'number' }).notNull().default(0),
  showIf: text('show_if'),
  viewJson: text('view_json').notNull().default('{}'),
}, t => [
  primaryKey({columns:[t.appId,t.viewName]}),
  index('idx_vigifts_views_position').on(t.appId,t.position,t.order),
]).enableRLS();
export const vigiftsActions = pgTable('vigifts_appsheet_actions', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  actionName: text('action_name').notNull(),
  displayName: text('display_name').notNull().default(''),
  tableName: text('table_name').notNull().default(''),
  actionType: text('action_type').notNull().default(''),
  icon: text('icon').notNull().default(''),
  condition: text('condition'),
  modifiesData: boolean('modifies_data').notNull().default(false),
  actionJson: text('action_json').notNull().default('{}'),
}, t => [
  primaryKey({columns:[t.appId,t.actionName,t.tableName]}),
  index('idx_vigifts_actions_table').on(t.appId,t.tableName),
]).enableRLS();
export const vigiftsBots = pgTable('vigifts_appsheet_bots', {
  appId: text('app_id').notNull().references(() => vigiftsApps.id),
  botName: text('bot_name').notNull(),
  eventName: text('event_name').notNull().default(''),
  processName: text('process_name').notNull().default(''),
  disabled: boolean('disabled').notNull().default(false),
  botJson: text('bot_json').notNull().default('{}'),
}, t => [
  primaryKey({columns:[t.appId,t.botName]}),
  index('idx_vigifts_bots_disabled').on(t.appId,t.disabled),
]).enableRLS();

/** Ánh xạ ảnh sản phẩm VIGIFTS. Trước đây tạo ngầm lúc chạy (lib/vigifts-mirror-api.mjs). */
export const vigiftsProductImageMap = pgTable('vigifts_product_image_map', {
  productId: text('product_id').primaryKey(),
  sku: text('sku').notNull(),
  productName: text('product_name').notNull(),
  imageFileName: text('image_file_name').notNull(),
  imageSourcePath: text('image_source_path').notNull(),
  imageUrl: text('image_url'),
  syncStatus: text('sync_status').notNull(),
  importedAt: text('imported_at').notNull(),
}, t => [index('idx_vigifts_product_image_map_sku').on(t.sku)]).enableRLS();
