// Đọc (chỉ đọc) mã giao diện của web Lock để tìm cách thêm giỏ hàng hiện tại. Không ghi gì lên hosting.
// Chỉ gọi Fileman/list_files và Fileman/get_file_content, chỉ trong <docroot>/wp-content/themes. In dòng khớp mẫu, không in token/tên đăng nhập/máy chủ.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!rawBase || !user || !token || !docroot || !docroot.startsWith('/') || docroot.includes('..')) throw new Error('Thiếu hoặc sai biến môi trường');
const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!baseUrl.port) baseUrl.port = '2083';
const ROOT = `${docroot}/wp-content/themes`;
const secrets = [token, user, baseUrl.hostname, baseUrl.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/((?:pass(?:word|wd)?|token|secret|key|auth)[=:\s]+)[^\s"',;\\]+/gi, '$1<che>'); };
const log = (...a) => console.log(redact(a.join(' ')));
const headers = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' };
let calls = 0;
async function uapi(fn, params) {
  if (++calls > 120) throw new Error('quá số lần gọi');
  const dir = String(params.dir || ''); if (!(dir === ROOT || dir.startsWith(ROOT + '/')) || dir.includes('..')) throw new Error('ngoài vùng cho phép');
  const url = new URL(`${baseUrl.origin}/execute/Fileman/${fn}`); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); const b = await r.json().catch(() => null);
  return b && b.status !== 0 ? b.data : null;
}
const PAT = /ajax_add_to_cart|ajax-add-to-cart|ajax_single_add|single_add_to_cart|wc-ajax|add_to_cart_button|ajax_add|variations_form/i;
async function grep(dir, file) {
  const d = await uapi('get_file_content', { dir, file }); const t = String(d?.content || '');
  const hits = t.split('\n').map((l, i) => [i + 1, l.trim()]).filter(([, l]) => PAT.test(l)).slice(0, 8);
  if (hits.length) { log(`# ${dir.replace(ROOT, '')}/${file}`); for (const [n, l] of hits) log(`  ${n}: ${l.slice(0, 170)}`); }
}
const themes = await uapi('list_files', { dir: ROOT, types: 'dir' }) || [];
log('Giao diện:', themes.map(x => x.file).join(', '));
for (const t of themes.map(x => x.file)) {
  const css = await uapi('get_file_content', { dir: `${ROOT}/${t}`, file: 'style.css' });
  log(`Giao diện ${t}:`, String(css?.content || '').split('\n').filter(l => /Theme Name|Version|Template/i.test(l)).slice(0, 3).join(' | '));
}
for (const t of themes.map(x => x.file)) {
  for (const sub of ['', 'inc/woocommerce', 'woocommerce/single-product', 'woocommerce/single-product/add-to-cart', 'assets/js']) {
    const dir = sub ? `${ROOT}/${t}/${sub}` : `${ROOT}/${t}`;
    const files = await uapi('list_files', { dir, types: 'file' }); if (!files) continue;
    for (const f of files) {
      if (!/\.(php|js)$/.test(f.file) || (Number(f.size) > 900_000)) continue;
      if (sub === 'assets/js' && !/^flatsome(\.js)?$|^flatsome\.js$/.test(f.file)) continue;
      if (sub === '' && !/functions\.php$/.test(f.file)) continue;
      await grep(dir, f.file);
    }
  }
}
log('XONG: chỉ đọc, số lần gọi', calls);
