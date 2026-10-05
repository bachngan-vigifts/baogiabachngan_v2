import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chốt chặn nâng cấp: áp migration từng bước trên DB ĐÃ CÓ DỮ LIỆU và kiểm tra dữ liệu còn nguyên.
 * (Migration sinh tự động kiểu "tạo bảng mới rồi chép dữ liệu" có thể hỏng âm thầm khi bảng có dòng – test trên DB trống không thấy.)
 * Dữ liệu mồi chỉ dùng cột tồn tại từ migration đầu tiên, nên còn dùng được khi có thêm migration về sau.
 */
const dir = join(import.meta.dirname, '..', '..', 'migrations');
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const statements = (f: string) => readFileSync(join(dir, f), 'utf8').split('--> statement-breakpoint').filter(s => s.trim());

test('mọi migration sau bản đầu giữ nguyên dữ liệu đang có', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const st of statements(files[0]!)) db.exec(st);
  const T = '2026-10-05T00:00:00.000Z';
  db.prepare("INSERT INTO staff_positions (id,name) VALUES ('sale','Sale')").run();
  db.prepare("INSERT INTO staff_members (id,email,name,role,position_id,created_at) VALUES ('m1','a@b.vn','An','employee','sale',?)").run(T);
  db.prepare("INSERT INTO staff_members (id,email,name,role,position_id,created_at) VALUES ('m2','n@b.vn','NCC','supplier','sale',?)").run(T);
  db.prepare("INSERT INTO staff_quotations (id,creator_id,quote_no,quote_type,customer,data,created_at,updated_at) VALUES ('q1','m1','BG1','B2B','K','{\"rows\":[]}',?,?)").run(T, T);
  db.prepare("INSERT INTO sapo_customers (id,name,contact,phone,email,address,search,source_version,synced_at) VALUES ('c1','A','','','','','a',1,?)").run(T);
  db.prepare("INSERT INTO incoming_shipments (id,ticket_number,warehouse,created_at,created_by,updated_at) VALUES ('s1','T1','K',?,'m1',?)").run(T, T);
  db.prepare("INSERT INTO incoming_shipment_lines (id,shipment_id,line_no,sku,quantity) VALUES ('l1','s1',1,'A1',5)").run();
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  const before = Object.fromEntries(['staff_members', 'staff_quotations', 'sapo_customers', 'incoming_shipments', 'incoming_shipment_lines'].map(t => [t, count(t)]));

  for (const f of files.slice(1)) for (const st of statements(f)) db.exec(st);

  for (const [t, n] of Object.entries(before)) assert.equal(count(t), n, `${t} mất dữ liệu khi nâng cấp`);
  assert.equal((db.prepare("SELECT creator_id c FROM staff_quotations WHERE id='q1'").get() as { c: string }).c, 'm1');
  assert.equal((db.prepare("SELECT ticket_number t, quantity FROM incoming_shipments s JOIN incoming_shipment_lines l ON l.shipment_id=s.id").get() as { t: string }).t, 'T1');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
