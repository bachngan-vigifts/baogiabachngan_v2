// DDL do bản cũ tự chạy lúc runtime (CREATE TABLE IF NOT EXISTS trong lib/*.mjs).
// Giữ nguyên văn để test chứng minh schema mới là tập cha của chúng.
export const legacyRuntimeDdl: Record<string, string> = {
  printing_workshops: `CREATE TABLE printing_workshops (id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,tax_code TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,created_by TEXT NOT NULL)`,
  quote_order_followups: `CREATE TABLE quote_order_followups (quote_id TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  sapo_runtime_sessions: `CREATE TABLE sapo_runtime_sessions (id TEXT PRIMARY KEY, encrypted_cookie TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  sapo_health_monitor_state: `CREATE TABLE sapo_health_monitor_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  vigifts_product_image_map: `CREATE TABLE vigifts_product_image_map (product_id TEXT PRIMARY KEY, sku TEXT NOT NULL, product_name TEXT NOT NULL, image_file_name TEXT NOT NULL, image_source_path TEXT NOT NULL, image_url TEXT, sync_status TEXT NOT NULL, imported_at TEXT NOT NULL)`,
};
