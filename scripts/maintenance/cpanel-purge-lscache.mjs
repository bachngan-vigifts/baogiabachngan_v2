// Dọn toàn bộ cache trang của LiteSpeed Cache (web Lock) bằng lệnh chính thức do_action('litespeed_purge_all').
// Cách làm: đặt 1 mu-plugin tạm, chỉ chạy khi request có mã riêng, tự xóa sau khi chạy; kích hoạt bằng 1 request GET.
// Trước/sau: đo header Cloudflare/LiteSpeed và xem HTML còn đoạn script cũ (wc_fragment_refresh) không.
// Khóa cứng: chỉ ghi/xóa đúng 1 file lnl-purge-once.php trong mu-plugins. Không in token/tên đăng nhập/máy chủ.
import { randomBytes } from 'node:crypto';
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
const DIR = `${docroot}/wp-content/mu-plugins`, FILE = 'lnl-purge-once.php';
const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)[^\s"',;\\]+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-purge-lscache' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CODE = randomBytes(12).toString('hex');
const SRC = `<?php
/**
 * One-time LiteSpeed cache purge. Runs only for a request that carries the secret code, then deletes itself.
 */
if (!defined('ABSPATH')) {
    exit;
}
add_action('wp_loaded', function () {
    if (is_admin() || (defined('DOING_AJAX') && DOING_AJAX) || (defined('REST_REQUEST') && REST_REQUEST)) {
        return;
    }
    if (!isset($_GET['lnl_purge']) || $_GET['lnl_purge'] !== '${CODE}') {
        return;
    }
    do_action('litespeed_purge_all');
    @unlink(__FILE__);
}, 99);
`;

async function listMu() {
  const url = new URL(`${origin}/execute/Fileman/list_files`); url.searchParams.set('dir', DIR);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await res.json().catch(() => null);
  return b && b.status !== 0 ? (b.data || []).map(f => f.file) : null;
}
async function saveTemp() {
  const res = await fetch(`${origin}/execute/Fileman/save_file_content`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ dir: DIR, file: FILE, content: SRC, from_charset: 'UTF-8', to_charset: 'UTF-8', fallback: '0' }), signal: AbortSignal.timeout(60_000) });
  const b = await res.json().catch(() => null); return res.ok && b && b.status !== 0;
}
async function removeTemp() {
  const url = new URL(`${origin}/json-api/cpanel`);
  for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'unlink', sourcefiles: `${DIR}/${FILE}`, doubledecode: 0 })) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await res.json().catch(() => null);
  return res.ok && b?.cpanelresult?.event?.result === 1;
}

const URLS = [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['category', '/danh-muc/binh-nuoc/']];
async function probe(label) {
  const out = {};
  for (const [name, path] of URLS) {
    try {
      const r = await fetch(SITE + path, { redirect: 'follow', headers: { 'User-Agent': 'cpanel-purge-check' }, signal: AbortSignal.timeout(30_000) });
      const text = (await r.text()).slice(0, 1_500_000);
      out[name] = { status: r.status, cf: r.headers.get('cf-cache-status') || '-', age: r.headers.get('age') || '-', ls: r.headers.get('x-litespeed-cache') || '-', cc: (r.headers.get('cache-control') || '-').slice(0, 40), oldScript: /wc_fragment_refresh/.test(text), phpError: /Fatal error|critical error|Parse error/i.test(text) };
    } catch (e) { out[name] = { status: 0, error: String(e?.message || e).slice(0, 60) }; }
  }
  log(`Trang (${label}):`); for (const [n, v] of Object.entries(out)) log(`  ${n}: ${JSON.stringify(v)}`);
  return out;
}

const report = { mode: MODE, at: new Date().toISOString() };
const before = await probe('trước');
report.before = before;
const healthy = Object.values(before).every(v => v.status === 200 && !v.phpError);
log(`KẾT LUẬN KIỂM TRA TRƯỚC: ${healthy ? 'AN TOÀN ĐỂ DỌN CACHE' : 'DỪNG — web đang lỗi'}`);
if (!healthy) process.exit(3);
const muBefore = await listMu();
if (!muBefore) { log('DỪNG: không đọc được thư mục mu-plugins'); process.exit(3); }

if (MODE === 'apply') {
  let cleaned = false;
  try {
    const saved = await saveTemp(); const present = saved && (await listMu() || []).includes(FILE);
    log(`Đặt mu-plugin tạm: ${present ? 'đạt' : 'LỖI'}`);
    if (!present) throw new Error('không đặt được file tạm');
    const t0 = performance.now();
    const r = await fetch(`${SITE}/?lnl_purge=${CODE}&t=${Date.now()}`, { redirect: 'manual', headers: { 'User-Agent': 'cpanel-purge-trigger' }, signal: AbortSignal.timeout(60_000) });
    await r.arrayBuffer();
    const purgeHdr = r.headers.get('x-litespeed-purge') || r.headers.get('x-litespeed-tag') || '-';
    log(`Kích hoạt: HTTP ${r.status}, ${Math.round(performance.now() - t0)} ms, header purge: ${redact(purgeHdr).slice(0, 40)}`);
    report.trigger = { status: r.status, purgeHeader: redact(purgeHdr).slice(0, 40) };
    await sleep(2000);
    const still = (await listMu() || []).includes(FILE);
    log(`File tạm đã tự xóa: ${!still}`);
    if (still) { const rm = await removeTemp(); const gone = !(await listMu() || []).includes(FILE); log(`Xóa file tạm thủ công: ${rm && gone ? 'đạt' : 'LỖI'}`); }
    cleaned = !(await listMu() || []).includes(FILE);
  } catch (e) {
    log('LỖI:', String(e.message || e));
    if ((await listMu() || []).includes(FILE)) { const rm = await removeTemp(); log(`Dọn file tạm sau lỗi: ${rm ? 'đạt' : 'LỖI — cần xóa tay lnl-purge-once.php'}`); }
    process.exitCode = 2;
  }
  await sleep(8000);
  const after1 = await probe('sau, lần 1'); await sleep(3000); const after2 = await probe('sau, lần 2');
  report.after1 = after1; report.after2 = after2; report.tempFileRemoved = cleaned;
  const clean = Object.values(after2).every(v => v.status === 200 && !v.phpError);
  const stale = Object.entries(after2).filter(([, v]) => v.oldScript).map(([n]) => n);
  log(`KẾT QUẢ: ${clean && cleaned ? 'ĐÃ DỌN CACHE LITESPEED, WEB BÌNH THƯỜNG' : 'CẦN XEM LẠI'}; trang còn script cũ: ${stale.length ? stale.join(', ') : 'không'}`);
  if (!(clean && cleaned)) process.exitCode = 2;
}
writeFileSync('lscache-purge.json', redact(JSON.stringify(report, null, 2)));
