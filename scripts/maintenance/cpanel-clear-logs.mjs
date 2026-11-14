// Làm rỗng đúng 2 file log lỗi PHP của web Lock: <home>/logs/php.error.log và <thư mục web>/error_log.
// Cách làm: ghi nội dung rỗng (giữ nguyên file để PHP vẫn ghi tiếp được). Nếu không được mới xóa file (unlink).
// MODE=dry-run (mặc định): chỉ kiểm tra. MODE=apply: thực hiện. Khóa cứng đúng 2 đường dẫn. Tự dừng nếu web lỗi.
import { writeFileSync } from 'node:fs';

const MODE = process.env.MODE === 'apply' ? 'apply' : 'dry-run';
const rawBase = (process.env.CPANEL_BASE_URL || '').trim();
const user = (process.env.CPANEL_USERNAME || '').trim();
const token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
if (!rawBase || !user || !token || !docroot) throw new Error('Thiếu CPANEL_BASE_URL / CPANEL_USERNAME / CPANEL_API_TOKEN / LOCKNLOCK_DOCROOT');
if (!docroot.startsWith('/') || docroot.includes('..') || docroot.split('/').filter(Boolean).length < 3) throw new Error('LOCKNLOCK_DOCROOT không hợp lệ');

const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`);
if (!baseUrl.port) baseUrl.port = '2083';
const origin = baseUrl.origin;
const home = docroot.replace(/\/[^/]+$/, '');
const TARGETS = [{ dir: `${home}/logs`, file: 'php.error.log' }, { dir: docroot, file: 'error_log' }];
const allowed = (dir, file) => TARGETS.some(t => t.dir === dir && t.file === file);

const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)[^\s"',;\\]+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-clear-logs' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const READ_OK = new Set(['Fileman/list_files', 'Quota/get_quota_info']);
async function uapi(mod, fn, params = {}) {
  const id = `${mod}/${fn}`;
  const isWrite = id === 'Fileman/save_file_content';
  if (!READ_OK.has(id) && !isWrite) throw new Error(`Hàm không được phép: ${id}`);
  if (isWrite && (!allowed(params.dir, params.file) || params.content !== '')) throw new Error('Ghi bị từ chối: chỉ được làm rỗng đúng 2 file log');
  const url = new URL(`${origin}/execute/${mod}/${fn}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.status === 0) return { ok: false, error: redact((body?.errors || [res.status]).join('; ')).slice(0, 160) };
  return { ok: true, data: body.data };
}
async function unlinkLog(dir, file) {
  if (!allowed(dir, file)) throw new Error('Xóa bị từ chối: ngoài danh sách');
  const url = new URL(`${origin}/json-api/cpanel`);
  const q = { cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'unlink', sourcefiles: `${dir}/${file}`, doubledecode: 0 };
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  const body = await res.json().catch(() => null); const r = body?.cpanelresult;
  const items = Array.isArray(r?.data) ? r.data : [];
  return res.ok && r?.event?.result === 1 && items.every(i => String(i.result) === '1');
}
const sizeOf = async (dir, file) => { const r = await uapi('Fileman', 'list_files', { dir, include_mime: 0, include_hash: 0, include_permissions: 0 }); const f = r.ok ? (r.data || []).find(x => x.file === file) : null; return f ? Number(f.size) : null; };
const mb = b => (b == null ? null : Math.round(b / 1048576 * 10) / 10);
const quotaMB = async () => { const r = await uapi('Quota', 'get_quota_info'); return r.ok ? Math.round(Number(r.data?.megabytes_used) || 0) : null; };
async function health() {
  const out = {};
  for (const [name, path] of [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['cart', '/gio-hang/']]) {
    const t0 = performance.now();
    try { const r = await fetch(SITE + path, { redirect: 'follow', headers: { 'User-Agent': 'cpanel-clear-logs-health' }, signal: AbortSignal.timeout(20_000) }); await r.arrayBuffer(); out[name] = { status: r.status, ms: Math.round(performance.now() - t0) }; }
    catch (e) { out[name] = { status: 0, ms: Math.round(performance.now() - t0) }; }
  }
  out.ok = out.home.status === 200 && out.product.status === 200 && out.cart.status === 200;
  return out;
}

const report = { mode: MODE, at: new Date().toISOString(), files: [] };
const before = { quotaMB: await quotaMB(), health: await health() };
log('Trước:', JSON.stringify(before));
const sizes0 = {};
for (const t of TARGETS) { sizes0[t.file] = await sizeOf(t.dir, t.file); log(`${t.file}: ${mb(sizes0[t.file])} MB ${sizes0[t.file] == null ? '(không có)' : ''}`); }
const safe = before.health.ok === true;
log(`KẾT LUẬN KIỂM TRA TRƯỚC: ${safe ? 'AN TOÀN' : 'KHÔNG AN TOÀN — DỪNG (web đang lỗi)'}`);

if (MODE === 'apply' && safe) {
  for (const t of TARGETS) {
    if (sizes0[t.file] == null) { report.files.push({ file: t.file, result: 'không có' }); continue; }
    let method = 'làm rỗng';
    const r = await uapi('Fileman', 'save_file_content', { dir: t.dir, file: t.file, content: '' });
    let after = await sizeOf(t.dir, t.file);
    if (!r.ok || (after != null && after > 1024)) {
      log(`${t.file}: làm rỗng không được (${r.ok ? 'kích thước ' + after : r.error}), thử xóa file`);
      method = 'xóa file';
      const ok = await unlinkLog(t.dir, t.file); after = await sizeOf(t.dir, t.file);
      if (!ok && after != null) { log(`DỪNG: ${t.file} không xử lý được`); report.files.push({ file: t.file, result: 'lỗi' }); process.exitCode = 2; break; }
    }
    log(`${t.file}: ${method}, ${mb(sizes0[t.file])} MB → ${after == null ? 'đã xóa' : mb(after) + ' MB'}`);
    report.files.push({ file: t.file, method, beforeMB: mb(sizes0[t.file]), afterMB: after == null ? null : mb(after) });
    const h = await health(); if (!h.ok) { log(`DỪNG: web bất thường sau ${t.file}: ${JSON.stringify(h)}`); process.exitCode = 2; break; }
  }
  // Đo tốc độ log mọc lại sau ~60 giây (cho biết PHP còn báo lỗi liên tục không)
  await sleep(Number(process.env.GROW_WAIT_MS ?? 60000));
  const grow = {};
  for (const t of TARGETS) grow[t.file] = mb(await sizeOf(t.dir, t.file));
  const after = { quotaMB: await quotaMB(), health: await health(), sizesAfter60sMB: grow };
  report.before = before; report.after = after;
  log('Sau:', JSON.stringify(after));
  if (before.quotaMB != null && after.quotaMB != null) log(`Giải phóng khoảng ${before.quotaMB - after.quotaMB} MB (quota ${before.quotaMB} → ${after.quotaMB} MB)`);
  log(`KẾT QUẢ: ${after.health.ok && process.exitCode !== 2 ? 'ĐÃ LÀM RỖNG LOG, WEB BÌNH THƯỜNG' : 'CẦN XEM LẠI'}`);
} else if (!safe) process.exitCode = 3;

writeFileSync('cpanel-clear-logs.json', redact(JSON.stringify(report, null, 2)));
