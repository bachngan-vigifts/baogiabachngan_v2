// Áp một kế hoạch sửa web Lock qua WooCommerce REST v3.
// Kế hoạch: JSON { "title": "...", "ops": [ { "method": "PUT"|"POST", "path": "/products/123", "body": {...}, "note": "..." } ] }
// - Chỉ cho phép đường dẫn trong ALLOW (sản phẩm, biến thể, danh mục, thẻ, thương hiệu, thuộc tính, giá trị thuộc tính).
// - Không DELETE, không force, không đụng đơn hàng/khách hàng/cài đặt/thanh toán.
// - PUT: đọc bản hiện tại, chỉ ghi các trường thay đổi, sao lưu giá trị cũ, đọc lại để xác nhận, sinh kế hoạch hoàn tác.
// - POST: chỉ tạo mới mục phân loại/thuộc tính/sản phẩm (sản phẩm mới luôn ở trạng thái nháp nếu không ghi rõ).
// MODE=dry-run (mặc định) chỉ đọc và in khác biệt; MODE=apply mới ghi.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const raw = (process.env.WC_BASE_URL || '').trim().replace(/\/+$/, '');
const key = process.env.WC_CONSUMER_KEY || '', secret = process.env.WC_CONSUMER_SECRET || '';
const mode = process.env.MODE === 'apply' ? 'apply' : 'dry-run';
const limit = Math.max(1, Math.min(500, Number(process.env.LIMIT || 20)));
const planPath = process.env.PLAN || '';
if (!raw || !key || !secret) throw new Error('Thiếu WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET');
if (!/^web-lock\/changes\/[\w.-]+\.json$/.test(planPath)) throw new Error('PLAN phải là web-lock/changes/<tên>.json');
const base = raw.replace(/\/wp-json.*$/, '') + '/wp-json/wc/v3';
const OUT = process.env.OUT_DIR || 'woo-apply-out';
mkdirSync(OUT, { recursive: true });

const ID = '\\d{1,9}';
const ALLOW = {
  PUT: [`/products/${ID}`, `/products/${ID}/variations/${ID}`, `/products/categories/${ID}`, `/products/tags/${ID}`, `/products/brands/${ID}`, `/products/attributes/${ID}`, `/products/attributes/${ID}/terms/${ID}`],
  POST: ['/products', `/products/${ID}/variations`, '/products/categories', '/products/tags', '/products/brands', '/products/attributes', `/products/attributes/${ID}/terms`],
};
const allowed = (m, p) => (ALLOW[m] || []).some(re => new RegExp(`^${re}$`).test(p));
const FORBIDDEN_KEYS = new Set(['id', '_links', 'date_created', 'date_created_gmt', 'date_modified', 'date_modified_gmt', 'permalink', 'price_html', 'total_sales', 'related_ids']);

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
if (!Array.isArray(plan.ops) || !plan.ops.length) throw new Error('Kế hoạch không có ops');
const problems = [];
plan.ops.forEach((op, i) => {
  if (!allowed(op.method, op.path)) problems.push(`#${i + 1}: không cho phép ${op.method} ${op.path}`);
  if (!op.body || typeof op.body !== 'object' || Array.isArray(op.body)) problems.push(`#${i + 1}: body phải là object`);
  for (const k of Object.keys(op.body || {})) if (FORBIDDEN_KEYS.has(k)) problems.push(`#${i + 1}: không ghi trường ${k}`);
  if (JSON.stringify(op).includes('"force"')) problems.push(`#${i + 1}: không dùng force`);
});
if (problems.length) { console.error(problems.join('\n')); process.exit(2); }

let useQueryAuth = false;
async function call(method, path, body) {
  const url = new URL(base + path);
  const headers = { Accept: 'application/json', 'User-Agent': 'store-change-runner' };
  if (useQueryAuth) { url.searchParams.set('consumer_key', key); url.searchParams.set('consumer_secret', secret); }
  else headers.Authorization = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000) });
  if (res.status === 401 && !useQueryAuth && method === 'GET') { useQueryAuth = true; return call(method, path, body); }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json };
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
// So sánh mềm: số/chuỗi số coi như nhau; mảng object (categories, tags, images...) so theo id nếu có.
function norm(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return String(Number(v));
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' && 'id' in x && Object.keys(x).length <= 3 ? { id: x.id } : norm(x)));
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]));
  return v;
}
const pickLike = (cur, body) => Object.fromEntries(Object.keys(body).map(k => {
  const c = cur?.[k];
  if (Array.isArray(body[k]) && Array.isArray(c) && body[k].every(x => x && typeof x === 'object' && 'id' in x && Object.keys(x).length === 1)) return [k, c.map(x => ({ id: x.id }))];
  if (body[k] && typeof body[k] === 'object' && !Array.isArray(body[k]) && c && typeof c === 'object') return [k, Object.fromEntries(Object.keys(body[k]).map(s => [s, c[s]]))];
  return [k, c];
}));

const ops = plan.ops.slice(0, limit);
const results = [], backup = [], undo = [], manualUndo = [];
let wrote = 0, unchanged = 0, failed = 0;
for (const [i, op] of ops.entries()) {
  const r = { n: i + 1, method: op.method, path: op.path, note: op.note || '' };
  try {
    if (op.method === 'PUT') {
      const cur = await call('GET', op.path);
      if (!cur.ok) throw new Error(`đọc lỗi ${cur.status} ${cur.json?.code || ''}`);
      const before = pickLike(cur.json, op.body);
      const changed = Object.fromEntries(Object.entries(op.body).filter(([k, v]) => !same(before[k], v)));
      r.name = cur.json.name; r.before = Object.fromEntries(Object.keys(changed).map(k => [k, before[k]])); r.after = changed;
      if (!Object.keys(changed).length) { r.result = 'không đổi'; unchanged++; results.push(r); continue; }
      backup.push({ path: op.path, name: cur.json.name, before: r.before });
      undo.push({ method: 'PUT', path: op.path, body: r.before, note: `Hoàn tác: ${op.note || ''}`.trim() });
      if (mode === 'apply') {
        const w = await call('PUT', op.path, changed);
        if (!w.ok) throw new Error(`ghi lỗi ${w.status} ${w.json?.code || ''} ${w.json?.message || ''}`);
        const back = await call('GET', op.path);
        const now = pickLike(back.json, changed);
        const mismatch = Object.keys(changed).filter(k => !same(now[k], changed[k]));
        r.result = mismatch.length ? `đã ghi nhưng đọc lại khác: ${mismatch.join(', ')}` : 'đã ghi, đọc lại khớp';
        if (mismatch.length) failed++; else wrote++;
      } else r.result = 'sẽ ghi';
    } else {
      const body = op.path === '/products' && !op.body.status ? { ...op.body, status: 'draft' } : op.body;
      r.after = body;
      if (mode === 'apply') {
        const w = await call('POST', op.path, body);
        if (!w.ok) throw new Error(`tạo lỗi ${w.status} ${w.json?.code || ''} ${w.json?.message || ''}`);
        r.createdId = w.json.id; r.result = `đã tạo id ${w.json.id}`; wrote++;
        manualUndo.push({ path: `${op.path}/${w.json.id}`, note: 'Mục mới tạo: chuyển nháp hoặc xoá tay trong wp-admin nếu cần hoàn tác' });
      } else r.result = 'sẽ tạo';
    }
  } catch (e) { r.result = 'LỖI: ' + (e?.message || e); failed++; }
  results.push(r);
}

const summary = { title: plan.title || planPath, plan: planPath, mode, totalOps: plan.ops.length, processed: ops.length, skippedByLimit: plan.ops.length - ops.length, wrote, unchanged, failed, at: new Date().toISOString() };
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ summary, results }, null, 2));
writeFileSync(`${OUT}/backup.json`, JSON.stringify(backup, null, 2));
writeFileSync(`${OUT}/undo-plan.json`, JSON.stringify({ title: `Hoàn tác: ${summary.title}`, ops: undo, manual: manualUndo }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of results) console.log(`#${r.n} ${r.method} ${r.path} ${r.name ? `(${r.name})` : ''} → ${r.result}${r.after ? `\n   trước: ${JSON.stringify(r.before ?? null)}\n   sau:   ${JSON.stringify(r.after)}` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(r => `| ${r.n} | ${r.method} ${r.path} | ${(r.name || '').replace(/\|/g, '/')} | ${r.result} |`).join('\n');
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${summary.title} (${mode})\nĐã ghi ${wrote}, không đổi ${unchanged}, lỗi ${failed}, bỏ qua do giới hạn ${summary.skippedByLimit}\n\n| # | Thao tác | Tên | Kết quả |\n|---|---|---|---|\n${rows}\n`, { flag: 'a' });
}
if (failed) process.exit(1);
