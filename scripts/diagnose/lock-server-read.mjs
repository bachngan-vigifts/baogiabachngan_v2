// CHẨN ĐOÁN CHỈ ĐỌC qua cPanel UAPI (chỉ GET). MODE=sample: lấy mẫu CPU/RAM mỗi 10 giây. MODE=state: trạng thái object cache (Redis) + log lỗi liên quan.
// Che: tên tài khoản, máy chủ, token, đường dẫn home, IP, email, mật khẩu trong cấu hình.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!rawBase || !user || !token) throw new Error('Thiếu biến môi trường');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const secrets = [token, user, b.hostname, b.host, docroot].filter(s => s && s.length >= 3).sort((x, y) => y.length - x.length);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/("?(?:pass(?:word|wd)?|pswd|user(?:name)?|token|secret|key|auth)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<che>"').replace(/\/home\d*\/[^/\s"']+/g, '/home/<che>'); };
async function call(mod, fn, params = {}) {
  if (!['ResourceUsage/get_usages', 'Fileman/list_files', 'Fileman/get_file_content'].includes(`${mod}/${fn}`)) throw new Error('không cho phép');
  const u = new URL(`${b.origin}/execute/${mod}/${fn}`); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => null); return j && j.status ? { ok: true, data: j.data } : { ok: false, err: redact((j && j.errors || []).join('; ') || r.status) };
}
const MODE = process.env.MODE || 'state';
if (MODE === 'sample') {
  const until = Date.now() + Number(process.env.SAMPLE_SECONDS || 600) * 1000;
  while (Date.now() < until) {
    const r = await call('ResourceUsage', 'get_usages').catch(e => ({ ok: false, err: e.message }));
    if (r.ok) { const m = Object.fromEntries((r.data || []).map(x => [x.id, x])); const extra = (r.data || []).filter(x => /lve|ep|nproc|io|iops|entry|proc/i.test(x.id) && !['lvecpu', 'lvemem', 'lvememphy'].includes(x.id)).map(x => `${x.id}=${x.usage}/${x.maximum}`).join(' '); console.log(`MẪU ${new Date().toISOString()} cpu=${m.lvecpu?.usage}/${m.lvecpu?.maximum} ramvl=${Math.round((m.lvememphy?.usage || 0) / 1048576)}MB/${Math.round((m.lvememphy?.maximum || 0) / 1048576)}MB ${extra}${(r.data || []).some(x => x.error) ? ' CÓ_LỖI_GIỚI_HẠN' : ''}`); }
    else console.log(`MẪU ${new Date().toISOString()} lỗi ${r.err}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
  console.log('Các chỉ số ResourceUsage có sẵn: ' + ((await call('ResourceUsage', 'get_usages')).data || []).map(x => x.id).join(', '));
  process.exit(0);
}
const list = async d => { const r = await call('Fileman', 'list_files', { dir: d, include_mime: 0, include_hash: 0, include_permissions: 0, showdotfiles: 1 }); return r.ok ? r.data : []; };
const read = async (dir, file) => { const r = await call('Fileman', 'get_file_content', { dir, file }); return r.ok ? String(r.data?.content ?? '') : null; };
const wc = await list(`${docroot}/wp-content`);
const names = wc.map(f => f.file);
console.log('wp-content có: object-cache.php=' + names.includes('object-cache.php') + ', advanced-cache.php=' + names.includes('advanced-cache.php') + ', .litespeed_conf.dat=' + names.includes('.litespeed_conf.dat') + ', object-cache.php.bak=' + names.includes('object-cache.php.bak') + ', debug.log=' + names.includes('debug.log'));
if (names.includes('object-cache.php')) { const t = await read(`${docroot}/wp-content`, 'object-cache.php'); console.log(`\nobject-cache.php: ${t ? t.length : '?'}B; nguồn: ${redact((t || '').split('\n').filter(l => /Plugin Name|LiteSpeed|Redis|Memcache|@package|Description|Version/i.test(l)).slice(0, 6).join(' | ')).slice(0, 400)}`); }
if (names.includes('.litespeed_conf.dat')) {
  const t = await read(`${docroot}/wp-content`, '.litespeed_conf.dat');
  try { const j = JSON.parse(t); const keys = Object.keys(j).filter(k => /^object/.test(k)); const out = {}; for (const k of keys) { let v = j[k]; if (/host/.test(k)) v = typeof v === 'string' ? (v.startsWith('/') ? `(socket, dài ${v.length} ký tự, đã che)` : v.replace(/[a-z0-9-]+\.[a-z.]+/gi, m => m === 'localhost' ? m : '<che>')) : v; if (/user|pswd|pass/.test(k)) v = v ? '(có, đã che)' : '(trống)'; out[k] = v; } console.log('\nCấu hình object cache LiteSpeed (.litespeed_conf.dat): ' + JSON.stringify(out)); } catch { console.log('\n.litespeed_conf.dat không đọc được dạng JSON (' + (t ? t.length : 0) + 'B)'); }
}
// Log lỗi: chỉ dòng liên quan, đã che, tối đa 40 dòng cuối mỗi file
const logs = [];
for (const [d, items] of [[docroot, await list(docroot)], [`${docroot}/wp-content`, wc]]) for (const f of items) if (/^(error_log|php_errorlog|debug\.log)$/i.test(f.file)) logs.push([d, f.file, Number(f.size) || 0, f.mtime]);
const lsd = await list(`${docroot}/wp-content/litespeed/debug`); for (const f of lsd) if (/\.log$/.test(f.file)) logs.push([`${docroot}/wp-content/litespeed/debug`, f.file, Number(f.size) || 0, f.mtime]);
for (const [d, f, size, mt] of logs) {
  console.log(`\nLOG ${d.replace(docroot, '.')}/${f}: ${Math.round(size / 1024)}KB, sửa lần cuối ${mt ? new Date(mt * 1000).toISOString() : '?'}`);
  if (size > 12 * 1048576) { console.log('   quá lớn, bỏ qua đọc'); continue; }
  const t = await read(d, f); if (!t) { console.log('   không đọc được'); continue; }
  const L = t.split('\n'); const hit = L.filter(l => /redis|object.?cache|memcache|connection refused|no such file|timed? ?out|max_children|resource temporarily|allowed memory|maximum execution|wdr|discount|deadlock|too many connections|mysql server has gone/i.test(l));
  const today = hit.filter(l => /15-Nov-2026|2026-11-15/.test(l));
  console.log(`   ${L.length} dòng; khớp từ khoá: ${hit.length}; trong hôm nay: ${today.length}`);
  const kinds = {}; for (const l of hit) { const k = redact(l.replace(/^\[[^\]]*\]\s*/, '').replace(/\d+/g, 'N')).slice(0, 140); kinds[k] = (kinds[k] || 0) + 1; }
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${v}x ${k}`);
  for (const l of today.slice(-8)) console.log('   gần nhất: ' + redact(l).slice(0, 200));
}
