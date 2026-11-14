// Thêm mu-plugin woo-ajax-add-to-cart.php (FILE MỚI, chưa tồn tại) lên hosting web Lock, hoặc gỡ nó (MODE=rollback).
// MODE=dry-run: chỉ kiểm tra. MODE=apply: ghi file, kiểm tra web, lỗi thì tự gỡ. MODE=rollback: gỡ file.
// Khóa cứng: chỉ ghi/xóa đúng 1 file <docroot>/wp-content/mu-plugins/woo-ajax-add-to-cart.php. Không in token/tên đăng nhập/máy chủ.
import { readFileSync } from 'node:fs';

const MODE = ['apply', 'rollback'].includes(process.env.MODE) ? process.env.MODE : 'dry-run';
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const SRC = process.env.SRC || 'web-lock/mu-plugins/woo-ajax-add-to-cart.php';
if (!rawBase || !user || !token || !docroot) throw new Error('Thiếu biến môi trường');
if (!docroot.startsWith('/') || docroot.includes('..') || docroot.split('/').filter(Boolean).length < 3) throw new Error('LOCKNLOCK_DOCROOT không hợp lệ');
const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!baseUrl.port) baseUrl.port = '2083';
const origin = baseUrl.origin, DIR = `${docroot}/wp-content/mu-plugins`, FILE = 'woo-ajax-add-to-cart.php';
const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)[^\s"',;\\]+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-deploy-ajax-atc' };

const newSrc = readFileSync(SRC, 'utf8');
if (!newSrc.startsWith('<?php') || newSrc.length > 9000 || /[^\x00-\x7f]/.test(newSrc) || /\beval\s*\(|base64_decode|shell_exec|passthru|\bexec\s*\(|system\s*\(/i.test(newSrc) || !/wc_ajax_lnl_add_to_cart/.test(newSrc) || !/__lnlAtc/.test(newSrc)) throw new Error('Bản mới không đạt kiểm tra nội dung');

async function listMu() {
  const url = new URL(`${origin}/execute/Fileman/list_files`); url.searchParams.set('dir', DIR);
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await r.json().catch(() => null);
  return b && b.status !== 0 ? (b.data || []).map(f => f.file) : null;
}
async function readFile() {
  const url = new URL(`${origin}/execute/Fileman/get_file_content`); url.searchParams.set('dir', DIR); url.searchParams.set('file', FILE);
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await r.json().catch(() => null);
  return b && b.status !== 0 ? String(b.data?.content ?? '') : null;
}
async function writeNew() {
  const r = await fetch(`${origin}/execute/Fileman/save_file_content`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ dir: DIR, file: FILE, content: newSrc, from_charset: 'UTF-8', to_charset: 'UTF-8', fallback: '0' }), signal: AbortSignal.timeout(60_000) });
  const b = await r.json().catch(() => null); return r.ok && b && b.status !== 0;
}
async function removeFile() {
  const url = new URL(`${origin}/json-api/cpanel`);
  for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'unlink', sourcefiles: `${DIR}/${FILE}`, doubledecode: 0 })) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await r.json().catch(() => null);
  return r.ok && b?.cpanelresult?.event?.result === 1;
}
async function discover() {
  const out = {};
  for (const type of ['simple', 'variable']) {
    try {
      const r = await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${type}&per_page=5&stock_status=instock`, { headers: { 'User-Agent': 'cpanel-deploy-health' }, signal: AbortSignal.timeout(30_000) });
      const j = await r.json(); const p = (Array.isArray(j) ? j : []).find(x => x.permalink && x.is_purchasable !== false);
      if (p) out[type] = new URL(p.permalink).pathname;
    } catch { /* bỏ qua */ }
  }
  return out;
}
let found = null;
async function health() {
  found = found || await discover();
  const out = {}; const bad = /Fatal error|critical error|Parse error|There has been a critical/i;
  const pages = [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['cart', '/gio-hang/']];
  for (const [k, v] of Object.entries(found)) pages.push([`p_${k}`, v]);
  for (const [name, path] of pages) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${SITE}${path}?hc=${Date.now()}`, { redirect: 'follow', headers: { 'User-Agent': 'cpanel-deploy-health' }, signal: AbortSignal.timeout(30_000) });
      const text = (await r.text()).slice(0, 8_000_000);
      out[name] = { status: r.status, ms: Math.round(performance.now() - t0), phpError: bad.test(text) };
      if (name === 'product' || name.startsWith('p_')) out[name].atc = (/__lnlAtc=\\?"?([\w-]+)/.exec(text) || [])[1] || 'none';
    } catch { out[name] = { status: 0, ms: Math.round(performance.now() - t0), phpError: false }; }
  }
  out.ok = pages.every(([k]) => out[k].status === 200 && !out[k].phpError);
  out.atcOn = Object.keys(found).length > 0 && Object.keys(found).every(k => out[`p_${k}`]?.atc === 'on');
  return out;
}

const files = await listMu();
if (!files) { log('LỖI: không đọc được thư mục mu-plugins'); process.exit(3); }
const exists = files.includes(FILE);
log(`File ${FILE} đã có trên hosting: ${exists}`);

if (MODE === 'rollback') {
  if (!exists) { log('Không có gì để gỡ.'); process.exit(0); }
  const rm = await removeFile(); const gone = !(await listMu() || []).includes(FILE); const h = await health();
  log(`Gỡ file: ${rm && gone ? 'đạt' : 'LỖI'}; web: ${JSON.stringify(h)}`); process.exit(rm && gone && h.ok ? 0 : 2);
}
if (exists) { log('DỪNG: file đã tồn tại (không ghi đè). Dùng MODE=rollback để gỡ.'); process.exit(3); }
const before = await health(); log('Web trước khi thêm:', JSON.stringify(before));
if (!before.ok) { log('DỪNG: web đang lỗi, không thêm file.'); process.exit(3); }
log('KẾT LUẬN KIỂM TRA TRƯỚC: AN TOÀN ĐỂ THÊM');

if (MODE === 'apply') {
  const w = await writeNew(); const same = w && (await readFile()) === newSrc;
  log(`Ghi file mới: ${same ? 'đạt (đọc lại khớp)' : 'LỖI'}`);
  let after = null;
  if (same) { await new Promise(r => setTimeout(r, 3000)); after = await health(); log('Web sau khi thêm:', JSON.stringify(after)); }
  if (!same || !after.ok || !after.atcOn) {
    log('GỠ LẠI do web bất thường, ghi lỗi hoặc trang sản phẩm chưa có đoạn script (có thể còn cache cũ)');
    const rm = await removeFile(); const gone = !(await listMu() || []).includes(FILE); const h2 = await health();
    log(`Gỡ lại: ${rm && gone ? 'đạt' : 'LỖI'}; web: ${JSON.stringify(h2)}`); process.exit(2);
  }
  log('KẾT QUẢ: ĐÃ THÊM woo-ajax-add-to-cart.php, WEB BÌNH THƯỜNG');
}
