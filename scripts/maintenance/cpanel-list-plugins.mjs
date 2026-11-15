// Liệt kê (chỉ đọc) tên thư mục plugin và mu-plugins của web Lock. Không đọc nội dung tệp, không ghi gì.
// Chỉ gọi Fileman/list_files và Fileman/get_file_content, chỉ trong <docroot>/wp-content/themes. In dòng khớp mẫu, không in token/tên đăng nhập/máy chủ.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!rawBase || !user || !token || !docroot || !docroot.startsWith('/') || docroot.includes('..')) throw new Error('Thiếu hoặc sai biến môi trường');
const baseUrl = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!baseUrl.port) baseUrl.port = '2083';
const ROOT = `${docroot}/wp-content/plugins`;
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
const dirs = await uapi('list_files', { dir: ROOT, types: 'dir' }) || [];
log('PLUGINS', dirs.map(d => d.file).sort().join(', '));
const files = await uapi('list_files', { dir: ROOT, types: 'file' }) || [];
log('TỆP LẺ', files.map(f => f.file).join(', '));
log('XONG: chỉ đọc, số lần gọi', calls);
