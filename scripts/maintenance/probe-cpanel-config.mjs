// Đọc cấu hình hosting cPanel của web Lock (chỉ GET tới UAPI, không ghi gì).
// Mục tiêu: biết PHP, bộ nhớ đệm đối tượng (Redis/Memcached), cron, dung lượng, giới hạn tài nguyên để tăng tốc web.
// Chỉ gọi các hàm trong DANH SÁCH CHO PHÉP bên dưới (đều là hàm đọc). Không đọc nội dung file (tránh wp-config).
// Mọi kết quả đi qua bước che: không in token, tên đăng nhập, máy chủ; lệnh cron chỉ in đầu lệnh đã che.
import { writeFileSync } from 'node:fs';

const rawBase = (process.env.CPANEL_BASE_URL || '').trim();
const user = (process.env.CPANEL_USERNAME || '').trim();
const token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!rawBase || !user || !token) throw new Error('Thiếu CPANEL_BASE_URL / CPANEL_USERNAME / CPANEL_API_TOKEN');

const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`);
if (!baseUrl.port) baseUrl.port = '2083';
const origin = baseUrl.origin;

// Danh sách cho phép: "Module/hàm". Thêm hàm ghi vào đây là sai quy tắc của workflow này.
const ALLOWED = new Set([
  'LangPHP/php_get_system_default_version',
  'LangPHP/php_get_vhost_versions',
  'LangPHP/php_get_installed_versions',
  'LangPHP/php_ini_get_user_basic_directives',
  'Features/list_features',
  'Cron/list_cron',
  'Quota/get_quota_info',
  'StatsBar/get_stats',
  'Mysql/list_databases',
  'ResourceUsage/get_usages',
  'DomainInfo/domains_data',
  'Fileman/list_files',
  'Fileman/get_file_content', // chỉ dùng cho .htaccess (lọc dòng PHP/cache) và phần đầu object-cache.php.bak
]);

// Che mọi giá trị nhạy cảm trong kết quả trước khi in/lưu.
const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
function redact(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('<che>');
  out = out.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)\S+/gi, '$1<che>');
  return out;
}

async function call(mod, fn, params = {}) {
  const id = `${mod}/${fn}`;
  if (!ALLOWED.has(id)) throw new Error(`Hàm không nằm trong danh sách cho phép: ${id}`);
  const url = new URL(`${origin}/execute/${mod}/${fn}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json', 'User-Agent': 'cpanel-config-probe' },
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = null; }
    if (!res.ok || !body) return { ok: false, status: res.status, error: redact(text.slice(0, 160)) };
    if (body.status === 0) return { ok: false, status: res.status, error: redact((body.errors || []).join('; ').slice(0, 200)) };
    return { ok: true, data: body.data, metadata: body.metadata?.result === undefined ? undefined : body.metadata.result };
  } catch (e) {
    return { ok: false, error: redact(String(e?.cause?.code || e?.message || e)).slice(0, 160) };
  }
}

const safe = async (fn) => { try { return await fn(); } catch (e) { return { ok: false, error: redact(String(e?.message || e)) }; } };
const trimList = (v, n = 60) => (Array.isArray(v) ? v.slice(0, n) : v);

const out = { at: new Date().toISOString(), note: 'Chỉ đọc. Giá trị nhạy cảm đã được che.' };

// 1) PHP
out.php = {
  systemDefault: await safe(() => call('LangPHP', 'php_get_system_default_version')),
  installed: await safe(() => call('LangPHP', 'php_get_installed_versions')),
  vhosts: await safe(async () => {
    const r = await call('LangPHP', 'php_get_vhost_versions');
    if (r.ok) r.data = trimList(r.data, 40);
    return r;
  }),
};

// 2) Tên miền → php.ini cơ bản (memory_limit, max_execution_time, …) của tên miền chính
const domains = await safe(() => call('DomainInfo', 'domains_data', { format: 'hash' }));
out.domains = domains.ok ? { main: domains.data?.main_domain?.domain ? redact(domains.data.main_domain.domain) : null, docroot: redact(domains.data?.main_domain?.documentroot || '') } : domains;
const mainDomain = domains.ok ? domains.data?.main_domain?.domain : null;
if (mainDomain) out.php.ini = await safe(() => call('LangPHP', 'php_ini_get_user_basic_directives', { type: 'vhost', vhost: mainDomain }));

// 3) Tính năng của gói hosting (xem có Redis/Memcached/LiteSpeed/Node… không)
out.features = await safe(async () => {
  const r = await call('Features', 'list_features');
  if (!r.ok) return r;
  const names = (Array.isArray(r.data) ? r.data : Object.keys(r.data || {})).map(x => (typeof x === 'object' ? x.id || x.name : x)).filter(Boolean).map(String).sort();
  const want = /redis|memcache|litespeed|lsws|cache|varnish|node|ruby|python|cron|ssh|php|mysql|postgres|backup|cdn|optimiz|ssl|image/i;
  return { ok: true, total: names.length, relevant: names.filter(n => want.test(n)) };
});

// 4) Cron: chỉ lịch + đầu lệnh đã che
out.cron = await safe(async () => {
  const r = await call('Cron', 'list_cron');
  if (!r.ok) return r;
  const list = (r.data || []).map(c => ({
    schedule: [c.minute, c.hour, c.day, c.month, c.weekday].join(' '),
    command: redact(String(c.command || '').split('?')[0]).slice(0, 70),
  }));
  return { ok: true, count: list.length, jobs: list.slice(0, 30) };
});

// 5) Dung lượng, hạn mức, CSDL
out.quota = await safe(() => call('Quota', 'get_quota_info'));
out.stats = await safe(() => call('StatsBar', 'get_stats', { display: 'diskusage|mysqldiskusage|inodeusage|addondomains|cachedmysqldiskusage' }));
out.databases = await safe(async () => {
  const r = await call('Mysql', 'list_databases');
  if (!r.ok) return r;
  return { ok: true, count: (r.data || []).length, items: (r.data || []).slice(0, 20).map(d => ({ name: redact(d.database || ''), diskMB: d.disk_usage != null ? Math.round(d.disk_usage / 1048576) : undefined })) };
});

// 6) Giới hạn tài nguyên CloudLinux (CPU/RAM/số tiến trình): nguyên nhân thường gặp khiến PHP chậm
out.resourceUsage = await safe(async () => {
  const r = await call('ResourceUsage', 'get_usages');
  if (!r.ok) return r;
  return { ok: true, items: (r.data || []).map(x => ({ id: x.id, description: x.description, usage: x.usage, maximum: x.maximum, percent: x.maximum ? Math.round((100 * x.usage) / x.maximum) : undefined, faults: x.error ? 1 : 0 })) };
});

// 7) Cây thư mục web: chỉ liệt kê TÊN (không đọc nội dung) để thấy object-cache.php, advanced-cache.php, .htaccess…
async function names(dir) {
  const r = await call('Fileman', 'list_files', { dir, 'include_mime': 0, 'include_hash': 0, 'include_permissions': 0 });
  if (!r.ok) return r;
  return { ok: true, names: (r.data || []).map(f => `${f.type === 'dir' ? 'd' : 'f'}:${f.file}`).slice(0, 120) };
}
if (docroot) {
  out.files = {
    docroot: await safe(() => names(docroot)),
    wpContent: await safe(() => names(`${docroot}/wp-content`)),
    muPlugins: await safe(() => names(`${docroot}/wp-content/mu-plugins`)),
  };
}

// 8) Đào sâu (có giới hạn): kích thước thư mục nghi ngờ, .htaccess (chỉ dòng PHP/cache), phần đầu object-cache.php.bak.
async function listDir(dir) {
  const r = await call('Fileman', 'list_files', { dir, include_mime: 0, include_hash: 0, include_permissions: 0 });
  return r.ok ? (r.data || []) : null;
}
const WALK_MAX_CALLS = 600, PER_DIR_CALLS = 90, WALK_DEADLINE = Date.now() + 7 * 60_000;
let walkCalls = 0;
async function walkSize(dir) {
  let bytes = 0, files = 0, dirs = 0, truncated = false, errors = 0;
  const big = [];
  const queue = [dir];
  let used = 0;
  while (queue.length) {
    if (used >= PER_DIR_CALLS || walkCalls >= WALK_MAX_CALLS || Date.now() > WALK_DEADLINE) { truncated = true; break; }
    const d = queue.shift();
    walkCalls++; used++;
    const items = await listDir(d);
    if (!items) { errors++; continue; }
    for (const f of items) {
      if (f.type === 'dir') { dirs++; queue.push(`${d}/${f.file}`); }
      else if (f.type === 'file') { files++; const sz = Number(f.size) || 0; bytes += sz; if (sz > 20 * 1048576) big.push({ file: `${d.replace(docroot, '.')}/${f.file}`, mb: Math.round(sz / 1048576) }); }
    }
  }
  return { mb: Math.round(bytes / 1048576), files, dirs, truncated: truncated || queue.length > 0, errors, big };
}
if (docroot) {
  out.deep = {};
  const wpc = await safe(() => listDir(`${docroot}/wp-content`));
  const targets = [];
  if (Array.isArray(wpc)) for (const f of wpc) if (f.type === 'dir') targets.push([`wp-content/${f.file}`, `${docroot}/wp-content/${f.file}`]);
  targets.push(['old', `${docroot}/old`], ['minhlongonline.com', `${docroot}/minhlongonline.com`]);
  const order = ['old', 'wp-content/upgrade-temp-backup', 'wp-content/upgrade', 'wp-content/litespeed-off', 'wp-content/litespeed_', 'minhlongonline.com', 'wp-content/uploads', 'wp-content/themes', 'wp-content/ai1wm-backups'];
  const rank = l => { const i = order.indexOf(l); return l === 'wp-content/plugins' ? 999 : i < 0 ? 500 : i; };
  targets.sort((a, b) => rank(a[0]) - rank(b[0]));
  out.deep.sizes = {};
  for (const [label, path] of targets) out.deep.sizes[label] = await safe(() => walkSize(path));
  out.deep.walkCalls = walkCalls;
  const root = await safe(() => listDir(docroot));
  if (Array.isArray(root)) out.deep.rootFiles = root.filter(f => f.type === 'file' && Number(f.size) > 1048576).map(f => ({ file: f.file, mb: Math.round(Number(f.size) / 1048576) }));
  const wp = Array.isArray(wpc) ? wpc.filter(f => f.type === 'file').map(f => ({ file: f.file, bytes: Number(f.size) || 0 })) : null;
  out.deep.wpContentFiles = wp;

  // Thư mục home (cha của public_html): 13 GB đĩa có thể nằm ngoài web (sao lưu, log, mail, tmp).
  const home = docroot.replace(/\/[^/]+$/, '');
  out.deep.home = await safe(async () => {
    const items = await listDir(home);
    if (!Array.isArray(items)) return { ok: false };
    const dirs = items.filter(f => f.type === 'dir' && f.file !== 'public_html' && f.file !== '.' && f.file !== '..');
    const sizes = {};
    for (const d of dirs.slice(0, 25)) sizes[d.file] = await safe(() => walkSize(`${home}/${d.file}`));
    const bigFiles = items.filter(f => f.type === 'file' && Number(f.size) > 20 * 1048576).map(f => ({ file: f.file, mb: Math.round(Number(f.size) / 1048576) }));
    return { ok: true, dirs: dirs.map(d => d.file), sizes, bigFiles };
  });

  // .htaccess: chỉ các dòng liên quan PHP/cache/nén, đã che.
  out.deep.htaccess = await safe(async () => {
    const r = await call('Fileman', 'get_file_content', { dir: docroot, file: '.htaccess' });
    if (!r.ok) return r;
    const lines = String(r.data?.content || '').split('\n');
    const want = /php|handler|litespeed|cache|expires|deflate|gzip|brotli|etag|keep-?alive|cloudflare|rewritecond.*%\{http|wordpress/i;
    const handler = /addhandler|addtype.*php|sethandler|suphp|lsphp|php_(value|flag)|ea-php|alt-php/i;
    return {
      ok: true, totalLines: lines.length,
      phpHandlerLines: lines.filter(l => handler.test(l)).map(l => redact(l.trim()).slice(0, 140)).slice(0, 20),
      matched: lines.filter(l => want.test(l) && !/ExpiresByType/i.test(l)).map(l => redact(l.trim()).slice(0, 140)).slice(0, 60),
    };
  });

  // object-cache.php.bak: chỉ dòng chú thích đầu file (tên/ phiên bản drop-in), không đọc phần mã/cấu hình.
  out.deep.objectCacheBak = await safe(async () => {
    const r = await call('Fileman', 'get_file_content', { dir: `${docroot}/wp-content`, file: 'object-cache.php.bak' });
    if (!r.ok) return r;
    const text = String(r.data?.content || '');
    const head = text.split('\n').slice(0, 40).filter(l => /^\s*(\/\/|\/\*|\*|#|<\?php)/.test(l)).map(l => redact(l.trim()).slice(0, 120));
    return { ok: true, bytes: text.length, header: head.slice(0, 25), mentionsRedis: /redis/i.test(text), mentionsMemcache: /memcache/i.test(text), mentionsLitespeed: /litespeed/i.test(text) };
  });
}

const json = redact(JSON.stringify(out, null, 2));
writeFileSync('cpanel-config.json', json);
console.log(json.slice(0, 60000));
if (out.deep) console.log('=== DEEP ===\n' + redact(JSON.stringify(out.deep, null, 2)).slice(0, 40000));
