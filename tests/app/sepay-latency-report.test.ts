import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../helpers/postgres.ts';

const sqlFile = join(import.meta.dirname, '../../scripts/sql/report-sepay-latency.sql');
const report = (days: number) => readFileSync(sqlFile, 'utf8').replaceAll('__DAYS__', String(days));
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

test('báo cáo độ trễ SePay chỉ đọc, tách webhook với lịch tải và đo QR quầy', async () => {
  const { client } = await createTestDb();
  const sql = readFileSync(sqlFile, 'utf8');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i);
  await client.exec(`set session_replication_role = replica`); // dữ liệu giả: bỏ qua khoá ngoại ca/quầy
  const qrId = '11111111-2222-3333-4444-555555555555', ref = 'POS' + qrId.replace(/-/g, '').slice(0, 12).toUpperCase();
  const pullAt = iso(60 * 60_000);
  await client.query(`insert into audit_logs(id,actor_id,module,action,entity_type,entity_id,data,created_at) values('a1','integration:sepay','sales','sepay.pull-today','sepay_import','d','{}',$1)`, [pullAt]);
  const tx = (id: string, bankAgo: number, received: string, content: string) => client.query(
    `insert into sepay_transactions(id,provider_id,transfer_type,amount,account_number,transaction_at,content,status,reason,match_method,payload,received_at)
     values($1,$1,'in',100000,'999',$2,$3,'unmatched','','reference','{}',$4)`, [id, iso(bankAgo), content, received]);
  await tx('w1', 10 * 60_000, iso(10 * 60_000 - 4_000), `CK ${ref} khach`); // webhook: 4 giây
  await tx('p1', 63 * 60_000, pullAt, 'CK khong ma'); // lịch tải: 180 giây
  await client.query(`insert into pos_payment_requests(id,shift_id,request_key,cart,fingerprint,amount,created_at,expires_at,confirmed_at) values($1,'s','k','{}','f',100000,$2,$3,$4)`,
    [qrId, iso(11 * 60_000), iso(-60_000), iso(10 * 60_000 - 6_000)]);
  await client.query(`insert into pos_payment_requests(id,shift_id,request_key,cart,fingerprint,amount,created_at,expires_at) values('q2','s','k2','{}','f',50000,$1,$2)`, [iso(5 * 60_000), iso(-60_000)]);

  const { rows } = await client.query<{ report: Record<string, any> }>(report(3));
  const r = rows[0]!.report;
  const by = Object.fromEntries(r.tien_vao_theo_nguon.map((s: any) => [s.source, s]));
  assert.equal(by.webhook.n, 1);
  assert.equal(Number(by.webhook.median_s), 4);
  assert.equal(by.lich_tai_5_phut.n, 1);
  assert.equal(Number(by.lich_tai_5_phut.median_s), 180);
  assert.equal(r.qr_quay.tong, 2);
  assert.equal(r.qr_quay.da_xac_nhan, 1);
  assert.equal(Number(r.qr_quay.tu_luc_ngan_hang_ghi_den_xac_nhan_median_s), 6);
  assert.equal(Number(r.qr_quay.tu_luc_hien_qr_den_xac_nhan_median_s), 66);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /khach|999|100000/, 'không lộ nội dung, tài khoản hay số tiền');
});
