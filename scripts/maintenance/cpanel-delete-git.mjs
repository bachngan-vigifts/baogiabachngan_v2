// Xóa thư mục .git nằm trong thư mục web của web Lock (kho bản chụp do công cụ AI tạo, không có remote).
// MODE=dry-run (mặc định): chỉ kiểm tra an toàn, không xóa. MODE=apply: xóa nếu kiểm tra an toàn.
// Khóa cứng: chỉ được xóa đúng <thư mục web>/.git và con của nó, chỉ thao tác "unlink" (xóa hẳn, không vào thùng rác).
// Tự dừng nếu web trả lỗi/chậm. Không in token/tên đăng nhập/máy chủ.
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
const G = `${docroot}/.git`;

const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)\S+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-delete-git' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- gọi cPanel ----
const READ_OK = new Set(['Fileman/list_files', 'Fileman/get_file_content', 'Quota/get_quota_info']);
async function uapi(mod, fn, params = {}) {
  if (!READ_OK.has(`${mod}/${fn}`)) throw new Error(`Hàm không được phép: ${mod}/${fn}`);
  const url = new URL(`${origin}/execute/${mod}/${fn}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.status === 0) return { ok: false, error: redact((body?.errors || [res.status]).join('; ')).slice(0, 160) };
  return { ok: true, data: body.data };
}
const listDir = async dir => { const r = await uapi('Fileman', 'list_files', { dir, include_mime: 0, include_hash: 0, include_permissions: 0, showdotfiles: 1, show_hidden: 1 }); return r.ok ? r.data || [] : null; };

// Xóa duy nhất qua API2 Fileman::fileop op=unlink, chỉ với đường dẫn nằm trong G.
function assertInGit(p) {
  if (!(p === G || p.startsWith(G + '/')) || p.includes('..') || /[\n\r,]/.test(p)) throw new Error(`Đường dẫn ngoài .git bị từ chối: ${redact(p)}`);
}
async function unlinkPaths(paths) {
  paths.forEach(assertInGit);
  const url = new URL(`${origin}/json-api/cpanel`);
  const q = { cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'unlink', sourcefiles: paths.join(','), doubledecode: 0 };
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
  const body = await res.json().catch(() => null);
  const r = body?.cpanelresult;
  const items = Array.isArray(r?.data) ? r.data : [];
  const ok = res.ok && r?.event?.result === 1 && items.every(i => String(i.result) === '1');
  return { ok, reason: ok ? '' : redact(items.map(i => i.reason).filter(Boolean).join('; ') || r?.error || `HTTP ${res.status}`).slice(0, 200) };
}

// ---- sức khỏe web (chỉ GET trang công khai) ----
async function health() {
  const out = {};
  for (const [name, path] of [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['cart', '/gio-hang/'], ['checkout', '/thanh-toan/']]) {
    const t0 = performance.now();
    try { const r = await fetch(SITE + path, { redirect: 'follow', headers: { 'User-Agent': 'cpanel-delete-git-health' }, signal: AbortSignal.timeout(20_000) }); await r.arrayBuffer(); out[name] = { status: r.status, ms: Math.round(performance.now() - t0) }; }
    catch (e) { out[name] = { status: 0, ms: Math.round(performance.now() - t0), error: String(e?.message || e).slice(0, 80) }; }
  }
  out.ok = out.home.status === 200 && out.home.ms < 4000 && out.product.status === 200 && out.cart.status === 200 && out.checkout.status === 200;
  return out;
}
const quotaMB = async () => { const r = await uapi('Quota', 'get_quota_info'); return r.ok ? Math.round(Number(r.data?.megabytes_used) || 0) : null; };
const phpLogMB = async () => { const l = await listDir(docroot.replace(/\/[^/]+$/, '') + '/logs'); const f = Array.isArray(l) ? l.find(x => x.file === 'php.error.log') : null; return f ? Math.round(Number(f.size) / 1048576) : null; };

// ---- kiểm tra trước ----
const report = { mode: MODE, at: new Date().toISOString(), checks: [] };
const check = (name, pass, detail = '') => { report.checks.push({ name, pass, detail }); log(`${pass ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? ' — ' + detail : ''}`); return pass; };

const top = await listDir(G);
check('.git tồn tại và liệt kê được', Array.isArray(top) && top.length > 0, Array.isArray(top) ? `${top.length} mục` : 'không đọc được');
const names = new Set((top || []).map(f => f.file));
check('Có cấu trúc kho Git (HEAD, config, objects)', ['HEAD', 'config', 'objects'].every(n => names.has(n)));

async function readSmall(dir, file, max = 300_000) {
  const l = await listDir(dir); const m = Array.isArray(l) ? l.find(f => f.file === file) : null;
  if (!m) return null; if (Number(m.size) > max) return '';
  const r = await uapi('Fileman', 'get_file_content', { dir, file }); return r.ok ? String(r.data?.content || '') : null;
}
const headTxt = await readSmall(G, 'HEAD'); const cfgTxt = await readSmall(G, 'config', 20_000); const reflog = await readSmall(`${G}/logs`, 'HEAD', 3_000_000);
check('Không có remote (không mất dữ liệu ở nơi khác)', cfgTxt != null && !/\[remote\s/i.test(cfgTxt));
const firstMsg = reflog ? (reflog.split('\n')[0].split('\t')[1] || '') : '';
check('Là kho bản chụp do công cụ AI tạo', /AI snapshot/i.test(firstMsg) && /auto-snapshot/i.test(reflog || ''), redact(firstMsg).slice(0, 60));

// mu-plugins và .htaccess không được nhắc tới .git
const mu = await listDir(`${docroot}/wp-content/mu-plugins`);
let refs = 0; const refFiles = [];
for (const f of (mu || []).filter(x => x.type === 'file' && /\.php$/i.test(x.file))) {
  const t = await readSmall(`${docroot}/wp-content/mu-plugins`, f.file); if (t == null) continue;
  const n = (t.match(/\.git(?![a-z0-9_-])/gi) || []).length; if (n) { refs += n; refFiles.push(`${f.file}:${n}`); }
}
const ht = await readSmall(docroot, '.htaccess'); const htRefs = ht ? (ht.match(/\.git(?![a-z0-9_-])/gi) || []).length : 0;
check('mu-plugins không nhắc tới .git', refs === 0, refs ? refFiles.join(', ') : `${(mu || []).length} mục`);
check('.htaccess không nhắc tới .git', htRefs === 0, htRefs ? `${htRefs} lần` : '');

const before = { quotaMB: await quotaMB(), phpLogMB: await phpLogMB(), health: await health() };
log('Trước xóa:', JSON.stringify(before));
check('Web đang khỏe (200, nhanh) trước khi xóa', before.health.ok === true);

const safe = report.checks.every(c => c.pass);
log(`KẾT LUẬN KIỂM TRA TRƯỚC: ${safe ? 'AN TOÀN ĐỂ XÓA' : 'KHÔNG AN TOÀN — DỪNG'}`);
report.before = before; report.safe = safe;

// ---- xóa ----
if (MODE === 'apply' && safe) {
  const objects = (await listDir(`${G}/objects`)) || [];
  const hexDirs = objects.filter(f => f.type === 'dir' && /^[0-9a-f]{2}$/.test(f.file)).map(f => f.file);
  log(`Thư mục object cần xóa: ${hexDirs.length}`);
  async function guarded(paths, label) {
    const r = await unlinkPaths(paths);
    if (!r.ok) { log(`DỪNG: xóa ${label} thất bại — ${r.reason}`); report.stopped = `xóa ${label} thất bại: ${r.reason}`; return false; }
    await sleep(2500);
    const h = await health();
    if (!h.ok) { log(`DỪNG: web có dấu hiệu chậm/lỗi sau ${label}: ${JSON.stringify(h)}`); report.stopped = `web bất thường sau ${label}`; return false; }
    return true;
  }
  let running = true;
  if (hexDirs.length) {
    // 1) thử một thư mục nhỏ trước, xác nhận biến mất
    const first = hexDirs[0];
    running = await guarded([`${G}/objects/${first}`], `objects/${first} (thử)`);
    if (running) { const still = (await listDir(`${G}/objects`) || []).some(f => f.file === first); if (still) { log('DỪNG: thư mục thử vẫn còn sau khi xóa'); report.stopped = 'xóa thử không có hiệu lực'; running = false; } else log('Xóa thử thành công, tiếp tục theo đợt'); }
    // 2) các đợt còn lại
    for (let i = 1; running && i < hexDirs.length; i += 6) {
      const batch = hexDirs.slice(i, i + 6).map(d => `${G}/objects/${d}`);
      running = await guarded(batch, `objects đợt ${Math.ceil(i / 6)}`);
      if (running && (i - 1) % 60 === 0) log(`Tiến độ: ${Math.min(i + 6, hexDirs.length)}/${hexDirs.length}`);
    }
  }
  // 3) phần còn lại của .git rồi chính .git
  if (running) {
    const rest = ((await listDir(G)) || []).map(f => `${G}/${f.file}`);
    for (const p of rest) { if (!running) break; running = await guarded([p], p.replace(G + '/', '')); }
  }
  if (running) running = await guarded([G], '.git');
  report.deleted = running;
}

// ---- kiểm tra sau ----
if (MODE === 'apply') {
  const rootNow = (await listDir(docroot)) || [];
  const gone = !rootNow.some(f => f.file === '.git');
  const after = { quotaMB: await quotaMB(), phpLogMB: await phpLogMB(), health: await health(), gitGone: gone, gitignoreKept: rootNow.some(f => f.file === '.gitignore') };
  report.after = after;
  log('Sau xóa:', JSON.stringify(after));
  if (before.quotaMB != null && after.quotaMB != null) log(`Giải phóng khoảng ${before.quotaMB - after.quotaMB} MB (quota ${before.quotaMB} → ${after.quotaMB} MB)`);
  log(`KẾT QUẢ: ${gone && after.health.ok ? 'ĐÃ XÓA .git, WEB BÌNH THƯỜNG' : 'CHƯA HOÀN TẤT / CẦN XEM LẠI'}`);
  if (!(gone && after.health.ok)) process.exitCode = 2;
} else if (!safe) process.exitCode = 3;

writeFileSync('cpanel-delete-git.json', redact(JSON.stringify(report, null, 2)));
