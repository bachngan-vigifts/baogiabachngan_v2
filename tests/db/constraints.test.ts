import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMigratedDb, seedStaffAndQuote, NOW } from './helpers.ts';

const lineSql = "INSERT INTO quote_lines (id,quote_id,line_no,name,qty,price) VALUES (?,?,?,?,?,?)";

test('quote_lines: bắt buộc có báo giá cha (khoá ngoại)', () => {
  const db = openMigratedDb();
  assert.throws(() => db.prepare(lineSql).run('l1', 'khong-co', 1, 'Nồi', 1, 100), /FOREIGN KEY/);
});

test('quote_lines: không trùng số dòng, không cho số lượng/giá âm, mặc định đúng', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  db.prepare(lineSql).run('l1', 'q1', 1, 'Nồi', 2, 100000);
  assert.throws(() => db.prepare(lineSql).run('l2', 'q1', 1, 'Chảo', 1, 1), /UNIQUE/);
  assert.throws(() => db.prepare(lineSql).run('l3', 'q1', 2, 'Chảo', -1, 1), /CHECK/);
  assert.throws(() => db.prepare(lineSql).run('l4', 'q1', 3, 'Chảo', 1, -5), /CHECK/);
  const r = db.prepare('SELECT discount_type d, tax_rate t, print_fee p FROM quote_lines WHERE id=?').get('l1') as { d: string; t: unknown; p: number };
  assert.deepEqual({ ...r }, { d: 'percent', t: null, p: 0 });
});

test('xoá báo giá kéo theo dòng hàng, lịch sử phiên bản và công nợ', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  db.prepare(lineSql).run('l1', 'q1', 1, 'Nồi', 1, 1);
  db.prepare("INSERT INTO quote_revisions (id,quote_id,revision,data,changed_by,created_at) VALUES ('r1','q1',1,'{}','m1',?)").run(NOW);
  db.prepare("INSERT INTO quote_order_followups (quote_id,data,updated_at,total,balance) VALUES ('q1','{}',?,500,500)").run(NOW);
  db.prepare("DELETE FROM staff_quotations WHERE id='q1'").run();
  for (const t of ['quote_lines', 'quote_revisions', 'quote_order_followups'])
    assert.equal((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, 0, t);
});

test('quote_revisions: mỗi (báo giá, phiên bản) chỉ một bản', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  const ins = () => db.prepare("INSERT INTO quote_revisions (id,quote_id,revision,data,changed_by,created_at) VALUES (?, 'q1', 1, '{}', 'm1', ?)").run(Math.random().toString(), NOW);
  ins(); assert.throws(ins, /UNIQUE/);
});

test('chiết khấu khách hàng chỉ nhận 0..100 và đúng 3 thương hiệu', () => {
  const db = openMigratedDb();
  db.prepare("INSERT INTO sapo_customers (id,name,contact,phone,email,address,search,source_version,synced_at) VALUES ('c1','A','','','','','a',1,?)").run(NOW);
  const ins = (brand: string, p: number) => db.prepare('INSERT INTO customer_brand_discounts (customer_id,brand_key,percent) VALUES (?,?,?)').run('c1', brand, p);
  ins('lock', 58); ins('lys', 0); ins('minhLong', 100);
  assert.throws(() => ins('lock', 5), /UNIQUE|PRIMARY/);
  db.prepare('DELETE FROM customer_brand_discounts').run();
  assert.throws(() => ins('lock', 101), /CHECK/);
  assert.throws(() => ins('lock', -1), /CHECK/);
});

test('catalog: SKU không trùng, thuế 0..100, giá âm bị chặn, tồn kho cho phép âm', () => {
  const db = openMigratedDb();
  db.prepare("INSERT INTO warehouses (id,name) VALUES ('w1','KHO VIGIFTS')").run();
  db.prepare("INSERT INTO price_policies (id,name) VALUES ('p1','Giá bán lẻ')").run();
  const prod = (sku: string, taxIn: number | null) => db.prepare('INSERT INTO products (sku,name,tax_in,updated_at) VALUES (?,?,?,?)').run(sku, 'Nồi', taxIn, NOW);
  prod('A1', 8); prod('A2', null);
  assert.throws(() => prod('A1', 8), /UNIQUE|PRIMARY/);
  assert.throws(() => prod('A3', 120), /CHECK/);
  db.prepare("INSERT INTO product_prices (sku,policy_id,price) VALUES ('A1','p1',NULL)").run();
  assert.throws(() => db.prepare("INSERT INTO product_prices (sku,policy_id,price) VALUES ('A2','p1',-1)").run(), /CHECK/);
  db.prepare("INSERT INTO product_stock (sku,warehouse_id,quantity,updated_at) VALUES ('A1','w1',-3,?)").run(NOW);
  assert.throws(() => db.prepare("INSERT INTO product_stock (sku,warehouse_id,quantity,updated_at) VALUES ('ZZ','w1',1,?)").run(NOW), /FOREIGN KEY/);
  db.prepare("DELETE FROM products WHERE sku='A1'").run();
  assert.equal((db.prepare('SELECT COUNT(*) n FROM product_stock').get() as { n: number }).n, 0);
});

test('catalog_versions: tại một thời điểm chỉ có một phiên bản hiện hành', () => {
  const db = openMigratedDb();
  const ins = (id: string, cur: number) => db.prepare("INSERT INTO catalog_versions (id,observed_at,product_count,is_current,created_by,created_at) VALUES (?,?,?,?,?,?)").run(id, NOW, 10, cur, 'sys', NOW);
  ins('v1', 0); ins('v2', 0); ins('v3', 1);
  assert.throws(() => ins('v4', 1), /UNIQUE/);
});

const shipIns = (db: ReturnType<typeof openMigratedDb>, id: string, ticket: string, extra: Record<string, unknown> = {}) => {
  const row = { id, ticket_number: ticket, warehouse: 'KHO VIGIFTS', created_at: NOW, created_by: 'm1', updated_at: NOW, ...extra };
  const cols = Object.keys(row);
  return db.prepare(`INSERT INTO incoming_shipments (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row) as never[]);
};
const lineIns = (db: ReturnType<typeof openMigratedDb>, id: string, shipment: string, no: number, sku: string, qty: number, extra: Record<string, unknown> = {}) => {
  const row = { id, shipment_id: shipment, line_no: no, sku, quantity: qty, ...extra };
  const cols = Object.keys(row);
  return db.prepare(`INSERT INTO incoming_shipment_lines (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row) as never[]);
};

test('incoming_shipments: mặc định đúng với phiếu hàng sắp về do manager nhập', () => {
  const db = openMigratedDb(); shipIns(db, 's1', 'PN-01');
  const r = db.prepare('SELECT source,approval_status a,supplier_status s,paid_amount p,deposit_rate d FROM incoming_shipments').get() as Record<string, unknown>;
  assert.deepEqual({ ...r }, { source: 'incoming-stock', a: 'approved', s: 'pending', p: 0, d: null });
});

test('incoming_shipments: số phiếu duy nhất KHÔNG phân biệt hoa thường (như bản cũ); mã phiếu giao hàng duy nhất, nhiều NULL được', () => {
  const db = openMigratedDb();
  shipIns(db, 'o1', 'T1'); shipIns(db, 'o2', 'T2'); shipIns(db, 'o3', 'T3', { delivery_note_id: 'DN1' });
  assert.throws(() => shipIns(db, 'o4', 'T1'), /UNIQUE/);
  assert.throws(() => shipIns(db, 'o4', 't1'), /UNIQUE/);
  assert.throws(() => shipIns(db, 'o5', 'T5', { delivery_note_id: 'DN1' }), /UNIQUE/);
});

test('GIỚI HẠN ĐÃ BIẾT: lower() của SQLite chỉ hạ chữ ASCII, nên ràng buộc "không phân biệt hoa thường" không bắt cặp chữ Việt khác hoa/thường', () => {
  // Bản cũ so sánh bằng JavaScript toLowerCase() (có Unicode). Nếu test này đổi kết quả, xem lại docs/INCOMING-STOCK-MAPPING.md.
  const db = openMigratedDb();
  shipIns(db, 'a', 'ĐƠN-01');
  assert.doesNotThrow(() => shipIns(db, 'b', 'đơn-01')); // JS coi hai số phiếu này là một; DB thì không
  assert.equal('ĐƠN-01'.toLowerCase(), 'đơn-01');
  // → tầng repo phải kiểm tra trùng bằng JS trước khi ghi; script chuyển dữ liệu phải báo các cặp trùng kiểu này.
});

test('incoming_shipments: chỉ nhận source/trạng thái hợp lệ ở tầng TypeScript; tầng DB chặn tỷ lệ cọc và số tiền sai', () => {
  const db = openMigratedDb();
  assert.throws(() => shipIns(db, 'a', 'A', { deposit_rate: 101 }), /CHECK/);
  assert.throws(() => shipIns(db, 'b', 'B', { deposit_rate: -1 }), /CHECK/);
  assert.throws(() => shipIns(db, 'c', 'C', { paid_amount: -5 }), /CHECK/);
  db.prepare("INSERT INTO suppliers (id,name,name_key,created_at,created_by,updated_at) VALUES ('sp1','Minh Long','minh long',?,'m1',?)").run(NOW, NOW);
  shipIns(db, 'd', 'D', { source: 'supplier-order', supplier_id: 'sp1', approval_status: 'pending', deposit_rate: 30, paid_amount: 1000 });
});

test('incoming_shipment_lines: SKU không lặp trong một phiếu (không phân biệt hoa thường), số dòng không lặp, các khoảng giá trị', () => {
  const db = openMigratedDb(); shipIns(db, 's1', 'T1'); shipIns(db, 's2', 'T2');
  lineIns(db, 'l1', 's1', 1, 'Abc-1', 10);
  assert.throws(() => lineIns(db, 'l2', 's1', 2, 'ABC-1', 5), /UNIQUE/);
  assert.throws(() => lineIns(db, 'l3', 's1', 1, 'Khac', 5), /UNIQUE/);
  lineIns(db, 'l4', 's2', 1, 'ABC-1', 5); // cùng SKU ở phiếu khác thì được
  assert.throws(() => lineIns(db, 'l5', 's1', 3, 'N1', -1), /CHECK/);
  assert.throws(() => lineIns(db, 'l6', 's1', 3, 'N2', 1, { price: -1 }), /CHECK/);
  assert.throws(() => lineIns(db, 'l7', 's1', 3, 'N3', 1, { tax_rate: 120 }), /CHECK/);
  assert.throws(() => lineIns(db, 'l8', 's1', 3, 'N4', 1, { purchase_discount: 101 }), /CHECK/);
  assert.throws(() => lineIns(db, 'l9', 's1', 3, 'N5', 1, { confirmed_purchase_discount: -1 }), /CHECK/);
  assert.throws(() => lineIns(db, 'la', 'khong-co', 1, 'N6', 1), /FOREIGN KEY/);
});

test('xoá phiếu kéo theo dòng hàng và yêu cầu xin hàng liên quan', () => {
  const db = openMigratedDb(); shipIns(db, 's1', 'T1'); lineIns(db, 'l1', 's1', 1, 'A', 10);
  db.prepare("INSERT INTO supplier_stock_requests (id,created_at,created_by) VALUES ('r1',?,'m1')").run(NOW);
  db.prepare("INSERT INTO supplier_stock_request_lines (request_id,line_no,shipment_id,sku,quantity,max_quantity) VALUES ('r1',1,'s1','A',4,10)").run();
  db.prepare("DELETE FROM incoming_shipments WHERE id='s1'").run();
  for (const t of ['incoming_shipment_lines', 'supplier_stock_request_lines'])
    assert.equal((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, 0, t);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM supplier_stock_requests').get() as { n: number }).n, 1); // yêu cầu cha còn (lịch sử)
});

test('yêu cầu xin hàng: không xin vượt số lượng tối đa hoặc bằng 0', () => {
  const db = openMigratedDb(); shipIns(db, 's1', 'T1');
  db.prepare("INSERT INTO supplier_stock_requests (id,created_at,created_by) VALUES ('r1',?,'m1')").run(NOW);
  const ins = (no: number, q: number, max: number) => db.prepare("INSERT INTO supplier_stock_request_lines (request_id,line_no,shipment_id,sku,quantity,max_quantity) VALUES ('r1',?,'s1','A',?,?)").run(no, q, max);
  ins(1, 10, 10);
  assert.throws(() => ins(2, 11, 10), /CHECK/);
  assert.throws(() => ins(3, 0, 10), /CHECK/);
  assert.throws(() => ins(1, 1, 10), /UNIQUE|PRIMARY/);
});

test('quote_shares: một người/chức vụ chỉ được chia sẻ một lần cho mỗi báo giá; xoá báo giá xoá luôn chia sẻ', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  const ins = (type: string, target: string) => db.prepare("INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES (?,?,?,?,?,?)").run(Math.random().toString(), 'q1', type, target, 'm1', NOW);
  ins('member', 'x'); ins('position', 'x'); // cùng chuỗi 'x' nhưng khác loại → được
  assert.equal((db.prepare("SELECT permission p FROM quote_shares WHERE target_type='member'").get() as { p: string }).p, 'edit'); // mặc định: được sửa
  assert.throws(() => db.prepare("UPDATE quote_shares SET permission='owner' WHERE target_type='member'").run(), /CHECK|constraint/i);
  assert.throws(() => ins('member', 'x'), /UNIQUE/);
  assert.throws(() => ins('position', ''), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES ('z','khong-co','member','x','m1',?)").run(NOW), /FOREIGN KEY/);
  db.prepare("DELETE FROM staff_quotations WHERE id='q1'").run();
  assert.equal((db.prepare('SELECT COUNT(*) n FROM quote_shares').get() as { n: number }).n, 0);
});

test('xưởng in: tên chuẩn hoá không được trùng', () => {
  const db = openMigratedDb();
  const ins = (id: string) => db.prepare("INSERT INTO printing_workshops (id,name,name_key,created_at,created_by) VALUES (?,?,?,?,?)").run(id, 'Minh Long', 'minh long', NOW, 'm1');
  ins('a'); assert.throws(() => ins('b'), /UNIQUE/);
});

test('DB từ chối giá trị enum lạ ở các bảng mới (đặc biệt quyền chia sẻ)', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  const bad = (sqlText: string) => assert.throws(() => db.exec(sqlText), /CHECK|constraint/i, sqlText);
  bad(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,permission,created_by,created_at) VALUES ('1','q1','member','x','owner','m1','${NOW}')`);
  bad(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,created_by,created_at) VALUES ('2','q1','group','x','m1','${NOW}')`);
  bad(`INSERT INTO customer_brand_discounts (customer_id,brand_key,percent) VALUES ('c1','khac',10)`);
  bad(`INSERT INTO quote_lines (id,quote_id,line_no,name,discount_type) VALUES ('l','q1',1,'N','fixed')`);
  bad(`INSERT INTO warehouses (id,name,kind) VALUES ('w','K','garage')`);
  bad(`INSERT INTO supplier_stock_requests (id,status,created_at,created_by) VALUES ('r','done','${NOW}','m1')`);
  for (const [col, val] of [['source', 'ban-le'], ['approval_status', 'rejected'], ['supplier_status', 'late'], ['delivery_ready_mode', 'half']])
    bad(`INSERT INTO incoming_shipments (id,ticket_number,warehouse,created_at,created_by,updated_at,${col}) VALUES ('s${col}','T${col}','K','${NOW}','m1','${NOW}','${val}')`);
  // NULL vẫn hợp lệ với cột cho phép NULL
  db.exec(`INSERT INTO incoming_shipments (id,ticket_number,warehouse,created_at,created_by,updated_at,delivery_ready_mode) VALUES ('ok','OK','K','${NOW}','m1','${NOW}',NULL)`);
  // giá trị hợp lệ vẫn vào được
  db.exec(`INSERT INTO quote_shares (id,quote_id,target_type,target_id,permission,created_by,created_at) VALUES ('v','q1','position','p','view','m1','${NOW}')`);
});

test('chốt chặn: mọi cột enum của bảng MỚI phải có CHECK trong DB (bảng cũ được miễn để không từ chối dữ liệu đang có)', async () => {
  const { getTableConfig } = await import('drizzle-orm/sqlite-core');
  const schema = await import('../../src/db/schema.ts');
  const legacy = await import('./fixtures/legacy-schema.ts');
  const { tablesIn } = await import('./helpers.ts');
  const legacyNames = new Set(tablesIn(legacy).map(t => getTableConfig(t).name));
  const db = openMigratedDb();
  const missing: string[] = [];
  for (const t of tablesIn(schema).map(getTableConfig)) {
    if (legacyNames.has(t.name)) continue;
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t.name) as { sql: string }).sql;
    for (const c of t.columns) {
      if (!c.enumValues) continue;
      // drizzle-kit sinh: CHECK("bảng"."cột" IN ('a', 'b'))
      if (!new RegExp(`"${t.name}"\\."${c.name}"\\s+IN\\s*\\(`).test(ddl)) missing.push(`${t.name}.${c.name}`);
    }
  }
  assert.deepEqual(missing, [], 'thiếu enumCheck cho: ' + missing.join(', '));
});

test('chủ báo giá (creator_id) không bao giờ đổi được – chặn ở tầng DB; người phụ trách (assignee_id) đổi được', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  db.prepare("INSERT INTO staff_members (id,email,name,created_at) VALUES ('m2','b@b.vn','Bình',?)").run(NOW);
  assert.throws(() => db.prepare("UPDATE staff_quotations SET creator_id='m2' WHERE id='q1'").run(), /creator_id/);
  assert.equal((db.prepare("SELECT creator_id c FROM staff_quotations WHERE id='q1'").get() as { c: string }).c, 'm1');
  db.prepare("UPDATE staff_quotations SET creator_id='m1', quote_no='BG-moi' WHERE id='q1'").run(); // ghi lại cùng giá trị / sửa cột khác thì được
  db.prepare("UPDATE staff_quotations SET assignee_id='m2' WHERE id='q1'").run();
  assert.equal((db.prepare("SELECT assignee_id a FROM staff_quotations WHERE id='q1'").get() as { a: string }).a, 'm2');
  db.prepare("UPDATE staff_quotations SET assignee_id=NULL WHERE id='q1'").run();
  assert.throws(() => db.prepare("UPDATE staff_quotations SET assignee_id='khong-co' WHERE id='q1'").run(), /FOREIGN KEY/);
});

const supIns = (db: ReturnType<typeof openMigratedDb>, id: string, name: string, key: string) =>
  db.prepare("INSERT INTO suppliers (id,name,name_key,created_at,created_by,updated_at) VALUES (?,?,?,?,'m1',?)").run(id, name, key, NOW, NOW);

test('suppliers: tên chuẩn hoá duy nhất, tên không rỗng', () => {
  const db = openMigratedDb();
  supIns(db, 's1', 'Minh Long', 'minh long');
  assert.throws(() => supIns(db, 's2', 'MINH  LONG', 'minh long'), /UNIQUE/);
  assert.throws(() => supIns(db, 's3', '   ', 'x'), /CHECK/);
  assert.throws(() => supIns(db, 's4', 'A', ''), /CHECK/);
  assert.equal((db.prepare('SELECT active a FROM suppliers').get() as { a: number }).a, 1); // mặc định đang hoạt động
});

test('supplier_contacts: email hợp lệ, không trùng (không phân biệt hoa thường) trong cùng NCC và loại, loại chỉ order/cc', () => {
  const db = openMigratedDb(); supIns(db, 's1', 'A', 'a'); supIns(db, 's2', 'B', 'b');
  const ins = (id: string, sup: string, kind: string, email: string) => db.prepare('INSERT INTO supplier_contacts (id,supplier_id,kind,email,created_at) VALUES (?,?,?,?,?)').run(id, sup, kind, email, NOW);
  ins('c1', 's1', 'order', 'Don@ncc.vn');
  assert.throws(() => ins('c2', 's1', 'order', 'don@NCC.vn'), /UNIQUE/);
  ins('c3', 's1', 'cc', 'don@ncc.vn'); // khác loại → được
  ins('c4', 's2', 'order', 'don@ncc.vn'); // khác NCC → được
  for (const bad of ['khong-co-a-cong', 'a b@x.vn', '@x.vn', 'a@x']) assert.throws(() => ins('x' + bad, 's1', 'order', bad), /CHECK/, bad);
  assert.throws(() => ins('c9', 's1', 'bcc', 'ok@x.vn'), /CHECK/);
  assert.throws(() => ins('c10', 'khong-co', 'order', 'ok@x.vn'), /FOREIGN KEY/);
  db.prepare("DELETE FROM suppliers WHERE id='s2'").run(); // xoá NCC (chưa có đơn) kéo theo liên hệ
  assert.equal((db.prepare("SELECT COUNT(*) n FROM supplier_contacts WHERE supplier_id='s2'").get() as { n: number }).n, 0);
});

test('supplier_accounts: mỗi tài khoản thuộc đúng một NCC; một NCC nhiều tài khoản; NCC có đơn thì không xoá được', () => {
  const db = openMigratedDb(); seedStaffAndQuote(db);
  db.prepare("INSERT INTO staff_members (id,email,name,created_at) VALUES ('n1','n1@x.vn','N1',?),('n2','n2@x.vn','N2',?)").run(NOW, NOW);
  supIns(db, 's1', 'A', 'a'); supIns(db, 's2', 'B', 'b');
  const link = (m: string, s: string) => db.prepare("INSERT INTO supplier_accounts (member_id,supplier_id,created_at,created_by) VALUES (?,?,?,'m1')").run(m, s, NOW);
  link('n1', 's1'); link('n2', 's1');
  assert.throws(() => link('n1', 's2'), /UNIQUE|PRIMARY/);
  assert.throws(() => link('n2', 'khong-co'), /UNIQUE|PRIMARY|FOREIGN KEY/);
  db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES ('o1','T1','supplier-order','s1','K',?,'m1',?)").run(NOW, NOW);
  assert.throws(() => db.prepare("DELETE FROM suppliers WHERE id='s1'").run(), /FOREIGN KEY/); // phải ngừng hoạt động thay vì xoá
  db.prepare("UPDATE suppliers SET active=0 WHERE id='s1'").run();
});

test('mọi đơn NCC phải thuộc một NCC trong danh mục; loại phiếu khác thì không bắt buộc', () => {
  const db = openMigratedDb();
  const ins = (id: string, source: string, sup: string | null) => db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES (?,?,?,?,'K',?,'m1',?)").run(id, 'T' + id, source, sup, NOW, NOW);
  assert.throws(() => ins('a', 'supplier-order', null), /CHECK/);
  assert.throws(() => ins('b', 'supplier-order', 'khong-co'), /FOREIGN KEY/);
  ins('c', 'incoming-stock', null); ins('d', 'supplier-delivery-note', null);
  supIns(db, 's1', 'A', 'a'); ins('e', 'supplier-order', 's1');
});

test('incoming_shipment_files: một file chữ ký cho mỗi phiếu, tối đa 6 MB, chỉ ảnh/PDF; xoá phiếu xoá file', () => {
  const db = openMigratedDb(); supIns(db, 's1', 'A', 'a');
  db.prepare("INSERT INTO incoming_shipments (id,ticket_number,source,supplier_id,warehouse,created_at,created_by,updated_at) VALUES ('o1','T1','supplier-order','s1','K',?,'m1',?)").run(NOW, NOW);
  const ins = (id: string, mime: string, size: number) => db.prepare("INSERT INTO incoming_shipment_files (id,shipment_id,r2_key,file_name,mime_type,size_bytes,uploaded_at,uploaded_by) VALUES (?,'o1','k','f',?,?,?,'n1')").run(id, mime, size, NOW);
  ins('f1', 'application/pdf', 6291456);
  assert.throws(() => ins('f2', 'image/png', 1000), /UNIQUE/); // đã có file chữ ký → tải lại phải thay (xoá rồi ghi)
  db.prepare("DELETE FROM incoming_shipment_files WHERE id='f1'").run();
  assert.throws(() => ins('f3', 'image/png', 6291457), /CHECK/);
  assert.throws(() => ins('f4', 'image/png', 0), /CHECK/);
  assert.throws(() => ins('f5', 'application/zip', 100), /CHECK/);
  assert.throws(() => ins('f6', 'image/jpg', 100), /CHECK/); // phải chuẩn hoá thành image/jpeg
  ins('f7', 'image/webp', 100);
  db.prepare("DELETE FROM incoming_shipments WHERE id='o1'").run();
  assert.equal((db.prepare('SELECT COUNT(*) n FROM incoming_shipment_files').get() as { n: number }).n, 0);
});
