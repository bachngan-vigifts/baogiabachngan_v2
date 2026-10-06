// Máy chủ giả lập cho BẢN DEMO (Artifact / xem thử không có Supabase).
// Thay fetch tới API bằng xử lý trong trình duyệt; dữ liệu mẫu lưu ở localStorage của người xem.
// Không dùng cho bản thật: bản thật gọi Edge Function `baogia-v2-api`.
import { totals, normalize } from './quote-math.js';

export const DEMO_API = 'https://demo.bachngan.local/api/staff';
const KEY = 'bn-demo-db-v1';
const now = () => new Date().toISOString();
const id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const day = n => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); };

function seed() {
  const positions = [
    { id: 'manager', name: 'Manager' }, { id: 'sale', name: 'Sale' }, { id: 'ke-toan', name: 'Kế toán' }, { id: 'kho', name: 'Kho' }, { id: 'supplier', name: 'NCC' },
  ];
  const members = [
    { id: 'm1', name: 'Trần Minh Anh', email: 'demo@bachngan.vn', phone: '0903 111 222', role: 'manager', positionId: 'manager', active: 1, activated: 1, password: 'demo1234' },
    { id: 'm2', name: 'Lê Thu Hà', email: 'ha.sale@bachngan.vn', phone: '0912 345 678', role: 'employee', positionId: 'sale', active: 1, activated: 1, password: 'demo1234' },
    { id: 'm3', name: 'Phạm Quốc Bảo', email: 'bao.kho@bachngan.vn', phone: '0938 222 333', role: 'employee', positionId: 'kho', active: 1, activated: 0 },
  ];
  const customers = [
    { id: 'c1', name: 'Công ty TNHH Hoa Mai', contact: 'Chị Lan', phone: '0901 234 567', email: 'lan@hoamai.vn', taxCode: '0312345678', customerCode: 'KH001', address: '12 Lê Lợi, Quận 1, TP.HCM' },
    { id: 'c2', name: 'Ngân hàng TMCP Sao Việt – CN Bình Thạnh', contact: 'Anh Tuấn', phone: '0987 654 321', email: 'tuan.nguyen@saoviet.vn', taxCode: '0301122334', customerCode: 'KH002', address: '45 Điện Biên Phủ, Bình Thạnh, TP.HCM' },
    { id: 'c3', name: 'Trường Quốc tế Ánh Dương', contact: 'Cô Ngọc', phone: '0909 888 777', email: '', taxCode: '', customerCode: 'KH003', address: '8 Nguyễn Văn Hưởng, Thủ Đức, TP.HCM' },
  ];
  const q = (no, c, type, date, rows, extra = {}) => ({
    id: id(), creatorId: 'm1', revision: 1, createdAt: date + 'T08:00:00.000Z', updatedAt: date + 'T09:30:00.000Z',
    data: { type, quoteNo: no, date, vat: 8, customerId: c.id, customer: c.name, contact: c.contact, phone: c.phone, email: c.email, customerTaxCode: c.taxCode, customerAddress: c.address, owner: 'Trần Minh Anh', ownerPhone: '0903 111 222', notes: 'Báo giá có hiệu lực trong 30 ngày.\nGiá chưa bao gồm phí vận chuyển.', rows: rows.map(r => ({ id: id(), sku: '', unit: 'cái', discount: 0, discountType: 'percent', printFee: 0, ...r })), ...extra },
  });
  const quotes = [
    q('BG-' + day(1).replaceAll('-', '') + '-001', customers[0], 'B2B', day(1), [
      { name: 'Bình giữ nhiệt Lock&Lock 500ml', sku: 'LHC4125', qty: 100, price: 185000, discount: 10, printFee: 5000, costPrice: 120000 },
      { name: 'Hộp quà Tết cao cấp', sku: 'HQ-TET-01', unit: 'hộp', qty: 50, price: 250000, costPrice: 180000 },
    ]),
    q('BG-' + day(4).replaceAll('-', '') + '-001', customers[1], 'VIGIFTS', day(4), [
      { name: 'Bộ ly sứ Minh Long in logo', sku: 'ML-LY-02', unit: 'bộ', qty: 200, price: 320000, discount: 25000, discountType: 'amount', printFee: 12000 },
    ]),
    q('BG-' + day(12).replaceAll('-', '') + '-002', customers[2], 'HRC', day(12), [
      { name: 'Hộp cơm thủy tinh Lock&Lock 3 ngăn', sku: 'LLG445', unit: 'hộp', qty: 300, price: 210000, discount: 5 },
      { name: 'Túi giữ nhiệt', sku: 'TGN-01', qty: 300, price: 45000 },
    ]),
  ];
  const policies = [{ id: 'le', name: 'Giá bán lẻ' }, { id: 'si', name: 'Giá sỉ' }];
  const warehouses = [{ id: 'q1', name: 'Kho Quận 1', kind: 'stock' }, { id: 'td', name: 'Kho Thủ Đức', kind: 'stock' }, { id: 'ncc', name: 'NCC', kind: 'supplier' }, { id: 'hcv', name: 'Hàng chờ về', kind: 'incoming' }];
  const P = (sku, name, brand, unit, le, si, q1, td) => ({ sku, name, brand, unit, pattern: '', imageUrl: '', taxable: true, taxOut: 8, taxBasis: 'Giá chưa bao gồm thuế', prices: [{ policyId: 'le', price: le }, { policyId: 'si', price: si }], stock: { q1, td, ncc: 0, hcv: 0 } });
  const products = [
    P('LHC4125', 'Bình giữ nhiệt Lock&Lock Energetic 500ml', 'Lock&Lock', 'cái', 185000, 166000, 120, 40),
    P('LHC4131', 'Bình giữ nhiệt Lock&Lock Feather Light 450ml', 'Lock&Lock', 'cái', 245000, 220000, 35, 0),
    P('LLG445', 'Hộp cơm thủy tinh Lock&Lock 3 ngăn', 'Lock&Lock', 'hộp', 210000, 189000, 8, 12),
    P('LBF-1', 'Bộ hộp bảo quản Lock&Lock 4 món', 'Lock&Lock', 'bộ', 329000, 296000, 0, 0),
    P('ML-LY-02', 'Bộ ly sứ Minh Long Jasmine 6 món', 'Minh Long', 'bộ', 320000, 288000, 60, 25),
    P('ML-CHEN-01', 'Bộ chén dĩa Minh Long Hoàng Cung 22 món', 'Minh Long', 'bộ', 2450000, 2205000, 6, 2),
    P('ML-HC-01', 'Nồi sứ dưỡng sinh Healthy Cook 1,5L', 'Minh Long', 'cái', 690000, 621000, 14, 9),
    P('LYS-500', 'Bình nước thủy tinh LYS 500ml', 'LYS', 'cái', 145000, 130000, 200, 80),
    P('LYS-SET', 'Bộ cốc thủy tinh LYS 6 chiếc', 'LYS', 'bộ', 260000, 234000, 45, 30),
    P('HQ-TET-01', 'Hộp quà Tết cao cấp Phúc Lộc', 'Bách Ngân', 'hộp', 250000, 225000, 150, 0),
    P('TGN-01', 'Túi giữ nhiệt in logo', 'Bách Ngân', 'cái', 45000, 40000, 500, 300),
    P('SO-DA-01', 'Sổ da A5 khắc tên', 'Bách Ngân', 'cuốn', 120000, 108000, 75, 20),
  ];
  return { positions, members, customers, quotes, policies, warehouses, products, sessions: {} };
}

let db;
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db?.quotes) db = seed();
  return db;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* chế độ riêng tư: chỉ giữ trong phiên */ } }
export function resetDemo() { db = seed(); save(); }

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const pub = m => ({ id: m.id, name: m.name, phone: m.phone, email: m.email, role: m.role, positionId: m.positionId, position: db.positions.find(p => p.id === m.positionId)?.name || '' });
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');

function cleanQuote(d) {
  if (!d || !['B2B', 'HRC', 'VIGIFTS'].includes(d.type) || !Array.isArray(d.rows)) fail(400, 'Báo giá không hợp lệ hoặc quá 300 dòng.');
  if (!d.rows.length) fail(400, 'Vui lòng chọn ít nhất 1 sản phẩm trước khi lưu báo giá.');
  if (!String(d.quoteNo || '').trim()) fail(400, 'Vui lòng nhập số báo giá.');
  for (const r of d.rows) for (const k of ['qty', 'price', 'discount', 'printFee']) if (!(Number(r[k] ?? 0) >= 0)) fail(400, 'Số liệu báo giá không hợp lệ.');
  return { ...d, rows: d.rows.map(r => ({ ...r, id: id(), discountType: r.discountType || 'percent' })) };
}

const fold = v => normalize(v).replace(/đ/g, 'd');
const matches = (text, q) => fold(q).split(' ').filter(Boolean).every(w => fold(text).includes(w));
let query = new URLSearchParams();
const page = def => ({ limit: Math.min(Number(query.get('limit')) || def, 500), offset: Number(query.get('offset')) || 0 });

function handle(method, path, body, auth) {
  load();
  if (!db.products) { const fresh = seed(); Object.assign(db, { policies: fresh.policies, warehouses: fresh.warehouses, products: fresh.products }); }
  const me = auth && db.sessions[auth] ? db.members.find(m => m.id === db.sessions[auth] && m.active) : null;
  const need = () => me || fail(401, 'Vui lòng đăng nhập.');
  const manager = () => (need().role === 'manager' ? me : fail(403, 'Chỉ Manager được dùng chức năng này.'));
  let m;
  if (method === 'POST' && path === '/login') {
    const u = db.members.find(x => x.email.toLowerCase() === String(body.email || '').trim().toLowerCase());
    if (!u || !u.active || u.password !== body.password) fail(401, 'Email hoặc mật khẩu không đúng.');
    const t = token(); db.sessions[t] = u.id; save();
    return { user: pub(u), sessionToken: t };
  }
  if (method === 'POST' && path === '/activate') {
    const u = db.members.find(x => x.activationToken && x.activationToken === body.token);
    if (!u) fail(400, 'Liên kết đã hết hạn hoặc đã được sử dụng.');
    if (String(body.password || '').length < 8) fail(400, 'Mật khẩu cần ít nhất 8 ký tự.');
    u.password = body.password; u.activated = 1; delete u.activationToken; save();
    return { ok: true };
  }
  if (method === 'GET' && path === '/me') return { user: pub(need()) };
  if (method === 'POST' && path === '/logout') { delete db.sessions[auth]; save(); return { ok: true, sessionToken: '' }; }
  if (method === 'POST' && path === '/password') {
    need(); if (me.password !== body.currentPassword) fail(400, 'Mật khẩu hiện tại không đúng.');
    me.password = body.password; for (const k of Object.keys(db.sessions)) if (db.sessions[k] === me.id) delete db.sessions[k]; save();
    return { ok: true, sessionToken: '' };
  }
  if (method === 'GET' && path === '/customers') {
    need();
    const all = [...db.customers].filter(c => matches(`${c.name} ${c.contact} ${c.phone} ${c.email} ${c.taxCode} ${c.customerCode}`, query.get('q'))).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const { limit, offset } = page(100);
    return { customers: all.slice(offset, offset + limit), total: all.length, limit, offset };
  }
  if (method === 'GET' && path === '/products') {
    need();
    const brand = query.get('brand') || '';
    const all = db.products.filter(p => (!brand || p.brand === brand) && matches(`${p.sku} ${p.name} ${p.brand}`, query.get('q'))).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const { limit, offset } = page(50);
    return { products: all.slice(offset, offset + limit), total: all.length, limit, offset, policies: db.policies, warehouses: db.warehouses, observedAt: day(0) + 'T07:00:00.000Z' };
  }
  if (method === 'GET' && path === '/product-brands') {
    need(); const m = new Map(); for (const p of db.products) m.set(p.brand, (m.get(p.brand) || 0) + 1);
    return { brands: [...m].sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([name, count]) => ({ name, count })) };
  }
  if ((method === 'POST' && path === '/customers') || (method === 'PUT' && (m = /^\/customers\/([^/]+)$/.exec(path)))) {
    need();
    const name = String(body.name || '').trim(); if (!name) fail(400, 'Vui lòng nhập tên khách hàng.');
    const row = { name, contact: '', phone: '', email: '', taxCode: '', customerCode: '', address: '' };
    for (const k of Object.keys(row)) if (k !== 'name') row[k] = String(body[k] || '').trim();
    if (m) { const c = db.customers.find(x => x.id === decodeURIComponent(m[1])) || fail(404, 'Không tìm thấy khách hàng.'); Object.assign(c, row); save(); return { id: c.id }; }
    const c = { id: id(), ...row }; db.customers.push(c); save(); return { id: c.id };
  }
  const visible = q => me.role === 'manager' || q.creatorId === me.id;
  if (method === 'GET' && path === '/quotes') {
    need();
    return { quotes: db.quotes.filter(visible).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(q => ({
      id: q.id, quoteNo: q.data.quoteNo, customer: q.data.customer, quoteType: q.data.type, revision: q.revision, updatedAt: q.updatedAt,
      total: totals(q.data).total, quoteDate: q.data.date, createdAt: q.createdAt, contact: q.data.contact || '', phone: q.data.phone || '', lineCount: q.data.rows.length, mine: q.creatorId === me.id,
    })) };
  }
  if ((m = /^\/quotes\/([^/]+)$/.exec(path))) {
    need();
    const q = db.quotes.find(x => x.id === decodeURIComponent(m[1]) && visible(x));
    if (method === 'GET') { if (!q) fail(404, 'Không tìm thấy báo giá.'); return { id: q.id, revision: q.revision, data: q.data }; }
    if (method === 'PUT') {
      if (!q || q.revision !== body.revision) fail(409, 'Báo giá đã thay đổi hoặc anh/chị không có quyền sửa. Vui lòng tải lại.');
      q.data = cleanQuote(body.data); q.revision += 1; q.updatedAt = now(); save();
      return { id: q.id, revision: q.revision, data: q.data };
    }
  }
  if (method === 'POST' && path === '/quotes') {
    need(); const data = cleanQuote(body), t = now();
    const q = { id: id(), creatorId: me.id, revision: 1, createdAt: t, updatedAt: t, data }; db.quotes.push(q); save();
    return { id: q.id, revision: 1, data };
  }
  if (method === 'GET' && path === '/admin/members') {
    manager(); return { members: db.members.map(x => ({ id: x.id, name: x.name, email: x.email, phone: x.phone, role: x.role, positionId: x.positionId, active: x.active, activated: x.activated })), positions: db.positions };
  }
  const link = u => { u.activationToken = token(); return `${location.origin}${location.pathname}#demo-kich-hoat`; };
  if (method === 'POST' && path === '/admin/members') {
    manager();
    if (db.members.some(x => x.email.toLowerCase() === String(body.email).toLowerCase())) fail(409, 'Email này đã có tài khoản. Vui lòng kiểm tra danh sách nhân viên.');
    const u = { id: id(), name: body.name, email: String(body.email).toLowerCase(), phone: body.phone, positionId: body.positionId, role: body.positionId === 'manager' ? 'manager' : body.positionId === 'supplier' ? 'supplier' : 'employee', active: 1, activated: 0 };
    db.members.push(u); const url = link(u); save();
    return { member: pub(u), url: url + ' (bản demo – liên kết mẫu, không gửi được)' };
  }
  if (method === 'POST' && path === '/admin/reset') {
    manager(); const u = db.members.find(x => x.id === body.id && x.active) || fail(404, 'Không tìm thấy nhân viên đang hoạt động.');
    if (u.id === me.id) fail(400, 'Dùng chức năng đổi mật khẩu cho tài khoản của mình.');
    const url = link(u); save(); return { url: url + ' (bản demo – liên kết mẫu, không gửi được)' };
  }
  if (method === 'DELETE' && path === '/admin/member') {
    manager(); const u = db.members.find(x => x.id === body.id) || fail(404, 'Không tìm thấy nhân viên.');
    if (u.id === me.id) fail(400, 'Không thể tự khoá tài khoản của mình.');
    u.active = 0; for (const k of Object.keys(db.sessions)) if (db.sessions[k] === u.id) delete db.sessions[k]; save(); return { ok: true };
  }
  if (method === 'PUT' && path === '/admin/member') {
    manager(); const u = db.members.find(x => x.id === body.id) || fail(404, 'Không tìm thấy nhân viên.');
    if (u.id === me.id) fail(400, 'Không thể tự đổi quyền của mình.');
    if (db.members.some(x => x.id !== u.id && x.email.toLowerCase() === String(body.email).toLowerCase())) fail(409, 'Email này đã có tài khoản.');
    Object.assign(u, { name: body.name, email: String(body.email).toLowerCase(), phone: body.phone, positionId: body.positionId, active: body.active ? 1 : 0, role: body.positionId === 'manager' ? 'manager' : body.positionId === 'supplier' ? 'supplier' : 'employee' });
    save(); return { ok: true };
  }
  fail(404, 'Không tìm thấy.');
}

/** Chặn fetch tới DEMO_API và trả lời bằng dữ liệu mẫu. */
export function installDemoApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (!url.startsWith(DEMO_API)) return real(input, init);
    await new Promise(r => setTimeout(r, 120));
    const auth = /^Bearer (\w+)$/.exec(init.headers?.authorization || '')?.[1];
    let status = 200, payload;
    try { query = new URL(url).searchParams; payload = handle(init.method || 'GET', url.slice(DEMO_API.length).split('?')[0], init.body ? JSON.parse(init.body) : {}, auth); if ((init.method || 'GET') === 'POST' && /\/(quotes|customers|admin\/members)$/.test(url)) status = 201; }
    catch (e) { status = e.status || 500; payload = { error: e.status ? e.message : 'Lỗi bản demo: ' + e.message }; }
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  };
}
