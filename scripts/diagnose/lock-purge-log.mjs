// CHỈ ĐỌC: đọc log dọn cache của LiteSpeed (wp-content/litespeed/debug/purge*.log) để biết cache bị dọn bao nhiêu lần, vì sao. Che IP/đường dẫn.
const rawBase = process.env.CPANEL_BASE_URL.trim(), user = process.env.CPANEL_USERNAME.trim(), token = process.env.CPANEL_API_TOKEN.trim(), docroot = process.env.LOCKNLOCK_DOCROOT.trim().replace(/\/+$/, '');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const H = { Authorization: `cpanel ${user}:${token}` }, dir = `${docroot}/wp-content/litespeed/debug`;
const red = t => String(t).split(docroot).join('<web>').split(user).join('<che>').replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>').replace(/[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,7}/gi, '<ip6>');
const lj = await (await fetch(`${b.origin}/execute/Fileman/list_files?dir=${encodeURIComponent(dir)}&include_mime=0`, { headers: H })).json();
for (const f of lj.data || []) console.log(`${f.file} ${Math.round(f.size / 1024)}KB ${new Date(f.mtime * 1000).toISOString()}`);
const pf = (lj.data || []).find(f => /^purge.*\.log$/.test(f.file));
if (pf) {
  const j = await (await fetch(`${b.origin}/execute/Fileman/get_file_content?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(pf.file)}`, { headers: H })).json();
  const L = String(j?.data?.content || '').split('\n'); console.log(`purge log ${L.length} dòng`);
  const kinds = {}; for (const l of L) { const m = /\[Purge\]\s*(.{0,90})/.exec(l) || /(Purge[^\n]{0,90})/i.exec(l); if (m) { const k = red(m[1]).replace(/\d+/g, 'N').slice(0, 90); kinds[k] = (kinds[k] || 0) + 1; } }
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v}x ${k}`);
  console.log('--- 40 dòng cuối'); for (const l of L.slice(-40)) console.log('  ' + red(l).slice(0, 200));
}
