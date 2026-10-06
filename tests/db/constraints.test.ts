import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMigratedDb, seedStaffAndQuote, NOW } from './helpers.ts';

const lineSql = "INSERT INTO quote_lines (id,quote_id,line_no,name,qty,price) VALUES (?,?,?,?,?,?)";

test('quote_lines: bắt buộc có báo giá cha (khoá ngoại)', async () => {
  const db = (await openMigratedDb());
  await assert.rejects(async () => (await db.prepare(lineSql).run('l1', 'khong-co', 1, 'Nồi', 1, 100)), /FOREIGN KEY/i);
});

test('quote_lines: không trùng số dòng, không cho số lượng/giá âm, mặc định đúng', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  (await db.prepare(lineSql).run('l1', 'q1', 1, 'Nồi', 2, 100000));
  await assert.rejects(async () => (await db.prepare(lineSql).run('l2', 'q1', 1, 'Chảo', 1, 1)), /UNIQUE/i);
  await assert.rejects(async () => (await db.prepare(lineSql).run('l3', 'q1', 2, 'Chảo', -1, 1)), /CHECK/i);
  await assert.rejects(async () => (await db.prepare(lineSql).run('l4', 'q1', 3, 'Chảo', 1, -5)), /CHECK/i);
  const r = (await db.prepare('SELECT discount_type d, tax_rate t, print_fee p FROM quote_lines WHERE id=?').get('l1')) as { d: string; t: unknown; p: number };
  assert.deepEqual({ ...r }, { d: 'percent', t: null, p: 0 });
});

test('xoá báo giá kéo theo dòng hàng, lịch sử phiên bản và công nợ', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  (await db.prepare(lineSql).run('l1', 'q1', 1, 'Nồi', 1, 1));
  (await db.prepare("INSERT INTO quote_revisions (id,quote_id,revision,data,changed_by,created_at) VALUES ('r1','q1',1,'{}','m1',?)").run(NOW));
  (await db.prepare("INSERT INTO quote_order_followups (quote_id,data,updated_at,total,balance) VALUES ('q1','{}',?,500,500)").run(NOW));
  (await db.prepare("DELETE FROM staff_quotations WHERE id='q1'").run());
  for (const t of ['quote_lines', 'quote_revisions', 'quote_order_followups'])
    assert.equal(((await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()) as { n: number }).n, 0, t);
});

test('quote_revisions: mỗi (báo giá, phiên bản) chỉ một bản', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  const ins = async () => (await db.prepare("INSERT INTO quote_revisions (id,quote_id,revision,data,changed_by,created_at) VALUES (?, 'q1', 1, '{}', 'm1', ?)").run(Math.random().toString(), NOW));
  (await ins()); await assert.rejects(ins, /UNIQUE/i);
});

test('chiết khấu khách hàng chỉ nhận 0..100 và đúng 3 thương hiệu', async () => {
  const db = (await openMigratedDb());
  (await db.prepare("INSERT INTO sapo_customers (id,name,contact,phone,email,address,search,source_version,synced_at) VALUES ('c1','A','','','','','a',1,?)").run(NOW));
  const ins = async (brand: string, p: number) => (await db.prepare('INSERT INTO customer_brand_discounts (customer_id,brand_key,percent) VALUES (?,?,?)').run('c1', brand, p));
  (await ins('lock', 58)); (await ins('lys', 0)); (await ins('minhLong', 100));
  await assert.rejects(async () => (await ins('lock', 5)), /UNIQUE|PRIMARY/i);
  (await db.prepare('DELETE FROM customer_brand_discounts').run());
  await assert.rejects(async () => (await ins('lock', 101)), /CHECK/i);
  await assert.rejects(async () => (await ins('lock', -1)), /CHECK/i);
});

test('catalog: SKU không trùng, thuế 0..100, giá âm bị chặn, tồn kho cho phép âm', async () => {
  const db = (await openMigratedDb());
  (await db.prepare("INSERT INTO warehouses (id,name) VALUES ('w1','KHO VIGIFTS')").run());
  (await db.prepare("INSERT INTO price_policies (id,name) VALUES ('p1','Giá bán lẻ')").run());
  const prod = async (sku: string, taxIn: number | null) => (await db.prepare('INSERT INTO products (sku,name,tax_in,updated_at) VALUES (?,?,?,?)').run(sku, 'Nồi', taxIn, NOW));
  (await prod('A1', 8)); (await prod('A2', null));
  await assert.rejects(async () => (await prod('A1', 8)), /UNIQUE|PRIMARY/i);
  await assert.rejects(async () => (await prod('A3', 120)), /CHECK/i);
  (await db.prepare("INSERT INTO product_prices (sku,policy_id,price) VALUES ('A1','p1',NULL)").run());
  await assert.rejects(async () => (await db.prepare("INSERT INTO product_prices (sku,policy_id,price) VALUES ('A2','p1',-1)").run()), /CHECK/i);
  (await db.prepare("INSERT INTO product_stock (sku,warehouse_id,quantity,updated_at) VALUES ('A1','w1',-3,?)").run(NOW));
  await assert.rejects(async () => (await db.prepare("INSERT INTO product_stock (sku,warehouse_id,quantity,updated_at) VALUES ('ZZ','w1',1,?)").run(NOW)), /FOREIGN KEY/i);
  (await db.prepare("DELETE FROM products WHERE sku='A1'").run());
  assert.equal(((await db.prepare('SELECT COUNT(*) n FROM product_stock').get()) as { n: number }).n, 0);
});

test('catalog_versions: tại một thời điểm chỉ có một phiên bản hiện hành', async () => {
  const db = (await openMigratedDb());
  const ins = async (id: string, cur: number) => (await db.prepare("INSERT INTO catalog_versions (id,observed_at,product_count,is_current,created_by,created_at) VALUES (?,?,?,?,?,?)").run(id, NOW, 10, cur, 'sys', NOW));
  (await ins('v1', 0)); (await ins('v2', 0)); (await ins('v3', 1));
  await assert.rejects(async () => (await ins('v4', 1)), /UNIQUE/i);
});

const shipIns = async (db: Awaited<ReturnType<typeof openMigratedDb>>, id: string, ticket: string, extra: Record<string, unknown> = {}) => {
  const row = { id, ticket_number: ticket, warehouse: 'KHO VIGIFTS', created_at: NOW, created_by: 'm1', updated_at: NOW, ...extra };
  const cols = Object.keys(row);
  return (await db.prepare(`INSERT INTO incoming_shipments (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row) as never[]));
};
const lineIns = async (db: Awaited<ReturnType<typeof openMigratedDb>>, id: string, shipment: string, no: number, sku: string, qty: number, extra: Record<string, unknown> = {}) => {
  const row = { id, shipment_id: shipment, line_no: no, sku, quantity: qty, ...extra };
  const cols = Object.keys(row);
  return (await db.prepare(`INSERT INTO incoming_shipment_lines (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row) as never[]));
};

test('incoming_shipments: mặc định đúng với phiếu hàng sắp về do manager nhập', async () => {
  const db = (await openMigratedDb()); (await shipIns(db, 's1', 'PN-01'));
  const r = (await db.prepare('SELECT source,approval_status a,supplier_status s,paid_amount p,deposit_rate d FROM incoming_shipments').get()) as Record<string, unknown>;
  assert.deepEqual({ ...r }, { source: 'incoming-stock', a: 'approved', s: 'pending', p: 0, d: null });
});

test('incoming_shipments: số phiếu duy nhất KHÔNG phân biệt hoa thường (như bản cũ); mã phiếu giao hàng duy nhất, nhiều NULL được', async () => {
  const db = (await openMigratedDb());
  (await shipIns(db, 'o1', 'T1')); (await shipIns(db, 'o2', 'T2')); (await shipIns(db, 'o3', 'T3', { delivery_note_id: 'DN1' }));
  await assert.rejects(async () => (await shipIns(db, 'o4', 'T1')), /UNIQUE/i);
  await assert.rejects(async () => (await shipIns(db, 'o4', 't1')), /UNIQUE/i);
  await assert.rejects(async () => (await shipIns(db, 'o5', 'T5', { delivery_note_id: 'DN1' })), /UNIQUE/i);
});

test('PostgreSQL: số phiếu Unicode không trùng khi khác hoa thường', async () => {
  const db = await openMigratedDb();
  await shipIns(db, 'a', 'ĐƠN-01');
  await assert.rejects(async () => (await shipIns(db, 'b', 'đơn-01')), /unique/i);
});

test('incoming_shipments: chỉ nhận source/trạng thái hợp lệ ở tầng TypeScript; tầng DB chặn tỷ lệ cọc và số tiền sai', async () => {
  const db = (await openMigratedDb());
  await assert.rejects(async () => (await shipIns(db, 'a', 'A', { deposit_rate: 101 })), /CHECK/i);
  await assert.rejects(async () => (await shipIns(db, 'b', 'B', { deposit_rate: -1 })), /CHECK/i);
  await assert.rejects(async () => (await shipIns(db, 'c', 'C', { paid_amount: -5 })), /CHECK/i);
  (await db.prepare("INSERT INTO suppliers (id,name,name_key,created_at,created_by,updated_at) VALUES ('sp1','Minh Long','minh long',?,'m1',?)").run(NOW, NOW));
  (await shipIns(db, 'd', 'D', { source: 'supplier-order', supplier_id: 'sp1', approval_status: 'pending', deposit_rate: 30, paid_amount: 1000 }));
});

test('incoming_shipment_lines: SKU không lặp trong một phiếu (không phân biệt hoa thường), số dòng không lặp, các khoảng giá trị', async () => {
  const db = (await openMigratedDb()); (await shipIns(db, 's1', 'T1')); (await shipIns(db, 's2', 'T2'));
  (await lineIns(db, 'l1', 's1', 1, 'Abc-1', 10));
  await assert.rejects(async () => (await lineIns(db, 'l2', 's1', 2, 'ABC-1', 5)), /UNIQUE/i);
  await assert.rejects(async () => (await lineIns(db, 'l3', 's1', 1, 'Khac', 5)), /UNIQUE/i);
  (await lineIns(db, 'l4', 's2', 1, 'ABC-1', 5)); // cùng SKU ở phiếu khác thì được
  await assert.rejects(async () => (await lineIns(db, 'l5', 's1', 3, 'N1', -1)), /CHECK/i);
  await assert.rejects(async () => (await lineIns(db, 'l6', 's1', 3, 'N2', 1, { price: -1 })), /CHECK/i);
  await assert.rejects(async () => (await lineIns(db, 'l7', 's1', 3, 'N3', 1, { tax_rate: 120 })), /CHECK/i);
  await assert.rejects(async () => (await lineIns(db, 'l8', 's1', 3, 'N4', 1, { purchase_discount: 101 })), /CHECK/i);
  await assert.rejects(async () => (await lineIns(db, 'l9', 's1', 3, 'N5', 1, { confirmed_purchase_discount: -1 })), /CHECK/i);
  await assert.rejects(async () => (await lineIns(db, 'la', 'khong-co', 1, 'N6', 1)), /FOREIGN KEY/i);
});

test('xoá phiếu kéo theo dòng hàng và yêu cầu xin hàng liên quan', async () => {
  const db = (await openMigratedDb()); (await shipIns(db, 's1', 'T1')); (await lineIns(db, 'l1', 's1', 1, 'A', 10));
  (await db.prepare("INSERT INTO supplier_stock_requests (id,created_at,created_by) VALUES ('r1',?,'m1')").run(NOW));
  (await db.prepare("INSERT INTO supplier_stock_request_lines (request_id,line_no,shipment_id,sku,quantity,max_quantity) VALUES ('r1',1,'s1','A',4,10)").run());
  (await db.prepare("DELETE FROM incoming_shipments WHERE id='s1'").run());
  for (const t of ['incoming_shipment_lines', 'supplier_stock_request_lines'])
    assert.equal(((await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()) as { n: number }).n, 0, t);
  assert.equal(((await db.prepare('SELECT COUNT(*) n FROM supplier_stock_requests').get()) as { n: number }).n, 1); // yêu cầu cha còn (lịch sử)
});

test('yêu cầu xin hàng: không xin vượt số lượng tối đa hoặc bằng 0', async () => {
  const db = (await openMigratedDb()); (await shipIns(db, 's1', 'T1'));
  (await db.prepare("INSERT INTO supplier_stock_requests (id,created_at,created_by) VALUES ('r1',?,'m1')").run(NOW));
  const ins = async (no: number, q: number, max: number) => (await db.prepare("INSERT INTO supplier_stock_request_lines (request_id,line_no,shipment_id,sku,quantity,max_quantity) VALUES ('r1',?,'s1','A',?,?)").run(no, q, max));
  (await ins(1, 10, 10));
  await assert.rejects(async () => (await ins(2, 11, 10)), /CHECK/i);
  await assert.rejects(async () => (await ins(3, 0, 10)), /CHECK/i);
  await assert.rejects(async () => (await ins(1, 1, 10)), /UNIQUE|PRIMARY/i);
});

test('quote_shares: một người/chức vụ chỉ được chia sẻ một lần cho mỗi báo giá; xoá báo giá xoá luôn chia sẻ', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  const ins = async (type: string, target: string) => (await db.prepare("INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES (?,?,?,?,?,?)").run(Math.random().toString(), 'q1', type, target, 'm1', NOW));
  (await ins('member', 'x')); (await ins('position', 'x')); // cùng chuỗi 'x' nhưng khác loại → được
  assert.equal(((await db.prepare("SELECT permission p FROM quote_shares WHERE target_type='member'").get()) as { p: string }).p, 'edit'); // mặc định: được sửa
  await assert.rejects(async () => (await db.prepare("UPDATE quote_shares SET permission='owner' WHERE target_type='member'").run()), /CHECK|constraint/i);
  await assert.rejects(async () => (await ins('member', 'x')), /UNIQUE/i);
  await assert.rejects(async () => (await ins('position', '')), /CHECK/i);
  await assert.rejects(async () => (await db.prepare("INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES ('z','khong-co','member','x','m1',?)").run(NOW)), /FOREIGN KEY/i);
  (await db.prepare("DELETE FROM staff_quotations WHERE id='q1'").run());
  assert.equal(((await db.prepare('SELECT COUNT(*) n FROM quote_shares').get()) as { n: number }).n, 0);
});

test('xưởng in: tên chuẩn hoá không được trùng', async () => {
  const db = (await openMigratedDb());
  const ins = async (id: string) => (await db.prepare("INSERT INTO printing_workshops (id,name,name_key,created_at,created_by) VALUES (?,?,?,?,?)").run(id, 'Minh Long', 'minh long', NOW, 'm1'));
  (await ins('a')); await assert.rejects(async () => (await ins('b')), /UNIQUE/i);
});

test('DB từ chối giá trị enum lạ ở các bảng mới (đặc biệt quyền chia sẻ)', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  const bad = async (sqlText: string) => await assert.rejects(async () => (await db.exec(sqlText)), /CHECK|constraint/i, sqlText);
  (await bad(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,permission,created_by,created_at) VALUES ('1','q1','member','x','owner','m1','${NOW}')`));
  (await bad(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES ('2','q1','group','x','m1','${NOW}')`));
  (await bad(`INSERT INTO customer_brand_discounts (customer_id,brand_key,percent) VALUES ('c1','khac',10)`));
  (await bad(`INSERT INTO quote_lines (id,quote_id,line_no,name,discount_type) VALUES ('l','q1',1,'N','fixed')`));
  (await bad(`INSERT INTO warehouses (id,name,kind) VALUES ('w','K','garage')`));
  (await bad(`INSERT INTO supplier_stock_requests (id,status,created_at,created_by) VALUES ('r','done','${NOW}','m1')`));
  for (const [col, val] of [['source', 'ban-le'], ['approval_status', 'rejected'], ['supplier_status', 'late'], ['delivery_ready_mode', 'half']])
    (await bad(`INSERT INTO incoming_shipments (id,ticket_number,warehouse,created_at,created_by,updated_at,${col}) VALUES ('s${col}','T${col}','K','${NOW}','m1','${NOW}','${val}')`));
  // NULL vẫn hợp lệ với cột cho phép NULL
  (await db.exec(`INSERT INTO incoming_shipments (id,ticket_number,warehouse,created_at,created_by,updated_at,delivery_ready_mode) VALUES ('ok','OK','K','${NOW}','m1','${NOW}',NULL)`));
  // giá trị hợp lệ vẫn vào được
  (await db.exec(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,permission,created_by,created_at) VALUES ('v','q1','position','p','view','m1','${NOW}')`));
});

test('mọi cột enum của bảng mới có CHECK trong PostgreSQL', async () => {
  const { getTableConfig } = await import('drizzle-orm/pg-core');
  const schema = await import('../../src/db/schema.ts');
  const { tablesIn, legacyTablesIn } = await import('./helpers.ts');
  const legacy = await import('./fixtures/legacy-schema.ts');
  const { getTableConfig: getLegacyConfig } = await import('drizzle-orm/sqlite-core');
  const old = new Set(legacyTablesIn(legacy).map(t => getLegacyConfig(t).name));
  const db = await openMigratedDb();
  const missing: string[] = [];
  for (const t of tablesIn(schema).map(getTableConfig)) {
    if (old.has(t.name)) continue;
    const checks = await db.client.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname=$1 AND c.contype='c'`, [t.name]);
    for (const c of t.columns) if (c.enumValues && !checks.rows.some(r => r.definition.includes(c.name))) missing.push(`${t.name}.${c.name}`);
  }
  assert.deepEqual(missing, []);
});

test('chủ báo giá (creator_id) không bao giờ đổi được – chặn ở tầng DB; người phụ trách (assignee_id) đổi được', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  (await db.prepare("INSERT INTO staff_members (id,email,name,created_at) VALUES ('m2','b@b.vn','Bình',?)").run(NOW));
  await assert.rejects(async () => (await db.prepare("UPDATE staff_quotations SET creator_id='m2' WHERE id='q1'").run()), /creator_id/);
  assert.equal(((await db.prepare("SELECT creator_id c FROM staff_quotations WHERE id='q1'").get()) as { c: string }).c, 'm1');
  (await db.prepare("UPDATE staff_quotations SET creator_id='m1', quote_no='BG-moi' WHERE id='q1'").run()); // ghi lại cùng giá trị / sửa cột khác thì được
  (await db.prepare("UPDATE staff_quotations SET assignee_id='m2' WHERE id='q1'").run());
  assert.equal(((await db.prepare("SELECT assignee_id a FROM staff_quotations WHERE id='q1'").get()) as { a: string }).a, 'm2');
  (await db.prepare("UPDATE staff_quotations SET assignee_id=NULL WHERE id='q1'").run());
  await assert.rejects(async () => (await db.prepare("UPDATE staff_quotations SET assignee_id='khong-co' WHERE id='q1'").run()), /FOREIGN KEY/i);
});

const supIns = async (db: Awaited<ReturnType<typeof openMigratedDb>>, id: string, name: string, key: string) =>
  (await db.prepare("INSERT INTO suppliers (id,name,name_key,created_at,created_by,updated_at) VALUES (?,?,?,?,'m1',?)").run(id, name, key, NOW, NOW));

test('suppliers: tên chuẩn hoá duy nhất, tên không rỗng', async () => {
  const db = (await openMigratedDb());
  (await supIns(db, 's1', 'Minh Long', 'minh long'));
  await assert.rejects(async () => (await supIns(db, 's2', 'MINH  LONG', 'minh long')), /UNIQUE/i);
  await assert.rejects(async () => (await supIns(db, 's3', '   ', 'x')), /CHECK/i);
  await assert.rejects(async () => (await supIns(db, 's4', 'A', '')), /CHECK/i);
  assert.equal(((await db.prepare('SELECT active a FROM suppliers').get()) as { a: number }).a, 1); // mặc định đang hoạt động
});

test('supplier_contacts: email hợp lệ, không trùng (không phân biệt hoa thường) trong cùng NCC và loại, loại chỉ order/cc', async () => {
  const db = (await openMigratedDb()); (await supIns(db, 's1', 'A', 'a')); (await supIns(db, 's2', 'B', 'b'));
  const ins = async (id: string, sup: string, kind: string, email: string) => (await db.prepare('INSERT INTO supplier_contacts (id,supplier_id,kind,email,created_at) VALUES (?,?,?,?,?)').run(id, sup, kind, email, NOW));
  (await ins('c1', 's1', 'order', 'Don@ncc.vn'));
  await assert.rejects(async () => (await ins('c2', 's1', 'order', 'don@NCC.vn')), /UNIQUE/i);
  (await ins('c3', 's1', 'cc', 'don@ncc.vn')); // khác loại → được
  (await ins('c4', 's2', 'order', 'don@ncc.vn')); // khác NCC → được
  for (const bad of ['khong-co-a-cong', 'a b@x.vn', '@x.vn', 'a@x']) await assert.rejects(async () => (await ins('x' + bad, 's1', 'order', bad)), /CHECK/i, bad);
  await assert.rejects(async () => (await ins('c9', 's1', 'bcc', 'ok@x.vn')), /CHECK/i);
  await assert.rejects(async () => (await ins('c10', 'khong-co', 'order', 'ok@x.vn')), /FOREIGN KEY/i);
  (await db.prepare("DELETE FROM suppliers WHERE id='s2'").run()); // xoá NCC (chưa có đơn) kéo theo liên hệ
  assert.equal(((await db.prepare("SELECT COUNT(*) n FROM supplier_contacts WHERE supplier_id='s2'").get()) as { n: number }).n, 0);
});

test('supplier_accounts: mỗi tài khoản thuộc đúng một NCC; một NCC nhiều tài khoản; NCC có đơn thì không xoá được', async () => {
  const db = (await openMigratedDb()); (await seedStaffAndQuote(db));
  (await db.prepare("INSERT INTO staff_members (id,email,name,created_at) VALUES ('n1','n1@x.vn','N1',?),('n2','n2@x.vn','N2',?)").run(NOW, NOW));
  (await supIns(db, 's1', 'A', 'a')); (await supIns(db, 's2', 'B', 'b'));
  const link = async (m: string, s: string) => (await db.prepare("INSERT INTO supplier_accounts (member_id,supplier_id,created_at,created_by) VALUES (?,?,?,'m1')").run(m, s, NOW));
  (await link('n1', 's1')); (await link('n2', 's1'));
  await assert.rejects(async () => (await link('n1', 's2')), /UNIQUE|PRIMARY/i);
  await assert.rejects(async () => (await link('n2', 'khong-co')), /UNIQUE|PRIMARY|FOREIGN KEY/i);
  (await db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES ('o1','T1','supplier-order','s1','K',?,'m1',?)").run(NOW, NOW));
  await assert.rejects(async () => (await db.prepare("DELETE FROM suppliers WHERE id='s1'").run()), /FOREIGN KEY/i); // phải ngừng hoạt động thay vì xoá
  (await db.prepare("UPDATE suppliers SET active=0 WHERE id='s1'").run());
});

test('mọi đơn NCC phải thuộc một NCC trong danh mục; loại phiếu khác thì không bắt buộc', async () => {
  const db = (await openMigratedDb());
  const ins = async (id: string, source: string, sup: string | null) => (await db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES (?,?,?,?,'K',?,'m1',?)").run(id, 'T' + id, source, sup, NOW, NOW));
  await assert.rejects(async () => (await ins('a', 'supplier-order', null)), /CHECK/i);
  await assert.rejects(async () => (await ins('b', 'supplier-order', 'khong-co')), /FOREIGN KEY/i);
  (await ins('c', 'incoming-stock', null)); (await ins('d', 'supplier-delivery-note', null));
  (await supIns(db, 's1', 'A', 'a')); (await ins('e', 'supplier-order', 's1'));
});

test('incoming_shipment_files: một file chữ ký cho mỗi phiếu, tối đa 6 MB, chỉ ảnh/PDF; xoá phiếu xoá file', async () => {
  const db = (await openMigratedDb()); (await supIns(db, 's1', 'A', 'a'));
  (await db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES ('o1','T1','supplier-order','s1','K',?,'m1',?)").run(NOW, NOW));
  const ins = async (id: string, mime: string, size: number) => (await db.prepare("INSERT INTO incoming_shipment_files (id,shipment_id,r2_key,file_name,mime_type,size_bytes,uploaded_at,uploaded_by) VALUES (?,'o1','k','f',?,?,?,'n1')").run(id, mime, size, NOW));
  (await ins('f1', 'application/pdf', 6291456));
  await assert.rejects(async () => (await ins('f2', 'image/png', 1000)), /UNIQUE/i); // đã có file chữ ký → tải lại phải thay (xoá rồi ghi)
  (await db.prepare("DELETE FROM incoming_shipment_files WHERE id='f1'").run());
  await assert.rejects(async () => (await ins('f3', 'image/png', 6291457)), /CHECK/i);
  await assert.rejects(async () => (await ins('f4', 'image/png', 0)), /CHECK/i);
  await assert.rejects(async () => (await ins('f5', 'application/zip', 100)), /CHECK/i);
  await assert.rejects(async () => (await ins('f6', 'image/jpg', 100)), /CHECK/i); // phải chuẩn hoá thành image/jpeg
  (await ins('f7', 'image/webp', 100));
  (await db.prepare("DELETE FROM incoming_shipments WHERE id='o1'").run());
  assert.equal(((await db.prepare('SELECT COUNT(*) n FROM incoming_shipment_files').get()) as { n: number }).n, 0);
});
