// Thay file mu-plugin woo-cart-optimize.php bằng bản mới trong repo (web-lock/mu-plugins/woo-cart-optimize.php).
// MODE=dry-run: chỉ kiểm tra. MODE=apply: sao lưu bản cũ (.bak-20261114, không tự chạy), ghi bản mới, kiểm tra web, lỗi thì tự khôi phục.
// Khóa cứng: chỉ ghi 2 file trong mu-plugins (file chính và file sao lưu). Không in token/tên đăng nhập/máy chủ.
import { readFileSync, writeFileSync } from 'node:fs';

const MODE = process.env.MODE === 'apply' ? 'apply' : 'dry-run';
const rawBase = (process.env.CPANEL_BASE_URL || '').trim();
const user = (process.env.CPANEL_USERNAME || '').trim();
const token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const SRC = process.env.SRC || 'web-lock/mu-plugins/woo-cart-optimize.php';
if (!rawBase || !user || !token || !docroot) throw new Error('Thiếu CPANEL_BASE_URL / CPANEL_USERNAME / CPANEL_API_TOKEN / LOCKNLOCK_DOCROOT');
if (!docroot.startsWith('/') || docroot.includes('..') || docroot.split('/').filter(Boolean).length < 3) throw new Error('LOCKNLOCK_DOCROOT không hợp lệ');

const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`);
if (!baseUrl.port) baseUrl.port = '2083';
const origin = baseUrl.origin;
const DIR = `${docroot}/wp-content/mu-plugins`, FILE = 'woo-cart-optimize.php', BAK = 'woo-cart-optimize.php.bak-20261114';

const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)[^\s"',;\\]+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-deploy-woo-cart' };

const newSrc = readFileSync(SRC, 'utf8');
if (!newSrc.startsWith('<?php') || newSrc.length > 6000 || /\beval\s*\(|base64_decode|shell_exec|passthru|\bexec\s*\(|system\s*\(/i.test(newSrc) || !/is_cart\(\)/.test(newSrc) || /wc_fragment_refresh/.test(newSrc)) throw new Error('Bản mới không đạt kiểm tra nội dung');

async function readFile(file) {
  const url = new URL(`${origin}/execute/Fileman/get_file_content`); url.searchParams.set('dir', DIR); url.searchParams.set('file', file);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await res.json().catch(() => null);
  return b && b.status !== 0 ? String(b.data?.content ?? '') : null;
}
async function writeFile(file, content) {
  const okTarget = (file === FILE && content === newSrc) || (file === BAK && content === original) || (file === FILE && content === original);
  if (!okTarget) throw new Error('Ghi bị từ chối: ngoài danh sách cho phép');
  const res = await fetch(`${origin}/execute/Fileman/save_file_content`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ dir: DIR, file, content, from_charset: 'UTF-8', to_charset: 'UTF-8', fallback: '0' }), signal: AbortSignal.timeout(60_000),
  });
  const b = await res.json().catch(() => null);
  return res.ok && b && b.status !== 0;
}
async function health() {
  const out = {}; const bad = /Fatal error|critical error|Parse error|There has been a critical/i;
  for (const [name, path] of [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['cart', '/gio-hang/']]) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${SITE}${path}?hc=${Date.now()}`, { redirect: 'follow', headers: { 'User-Agent': 'cpanel-deploy-health' }, signal: AbortSignal.timeout(30_000) });
      const text = (await r.text()).slice(0, 400_000);
      out[name] = { status: r.status, ms: Math.round(performance.now() - t0), phpError: bad.test(text) };
    } catch (e) { out[name] = { status: 0, ms: Math.round(performance.now() - t0), phpError: false }; }
  }
  out.ok = Object.values(out).every(v => v.status === 200 && !v.phpError);
  return out;
}

const original = await readFile(FILE);
if (original == null) { log('LỖI: không đọc được file hiện tại'); process.exit(3); }
writeFileSync('woo-cart-optimize.original.php', original);
const hasForcedRefresh = /wc_fragment_refresh/.test(original);
log(`File hiện tại: ${original.length} ký tự; có lệnh ép làm mới giỏ hàng: ${hasForcedRefresh}`);
if (!hasForcedRefresh) { log('DỪNG: file hiện tại không còn là bản em đã xem (có thể đã được sửa). Không ghi gì.'); process.exit(3); }
const before = await health(); log('Web trước khi thay:', JSON.stringify(before));
if (!before.ok) { log('DỪNG: web đang lỗi, không thay file.'); process.exit(3); }
log(`KẾT LUẬN KIỂM TRA TRƯỚC: AN TOÀN ĐỂ THAY`);

if (MODE === 'apply') {
  let ok = await writeFile(BAK, original);
  ok = ok && (await readFile(BAK)) === original;
  log(`Sao lưu bản cũ (${BAK}): ${ok ? 'đạt' : 'LỖI'}`);
  if (!ok) { log('DỪNG: sao lưu thất bại, chưa thay file.'); process.exit(2); }
  const w = await writeFile(FILE, newSrc);
  const same = w && (await readFile(FILE)) === newSrc;
  log(`Ghi bản mới: ${same ? 'đạt (đọc lại khớp)' : 'LỖI'}`);
  let after = same ? await health() : null; if (after) log('Web sau khi thay:', JSON.stringify(after));
  if (!same || !after.ok) {
    log('KHÔI PHỤC bản cũ do web bất thường hoặc ghi lỗi');
    const r = await writeFile(FILE, original); const back = r && (await readFile(FILE)) === original; const h2 = await health();
    log(`Khôi phục: ${back ? 'đạt' : 'LỖI'}; web: ${JSON.stringify(h2)}`);
    process.exit(2);
  }
  log('KẾT QUẢ: ĐÃ THAY woo-cart-optimize.php, WEB BÌNH THƯỜNG');
}
