// Đọc mức dùng tài nguyên hosting (CPU, RAM, số tiến trình, lỗi vượt giới hạn) qua cPanel UAPI ResourceUsage/get_usages. Chỉ đọc. Không in tên tài khoản/máy chủ.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
if (!rawBase || !user || !token) throw new Error('Thiếu biến môi trường');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const secrets = [token, user, b.hostname, b.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o; };
const rounds = Number(process.env.ROUNDS || 4);
for (let i = 1; i <= rounds; i++) {
  try {
    const r = await fetch(`${b.origin}/execute/ResourceUsage/get_usages`, { headers: { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
    const j = await r.json();
    console.log(`\n== Lần ${i} (${new Date().toISOString()})`);
    for (const x of j.data || []) if (!/disk|inode|bandwidth|ftp|email|addon|subdomain|parked|alias|mysql_databases|lists/i.test(x.id)) console.log(redact(`   ${x.id}: ${x.usage}${x.maximum ? ' / ' + x.maximum + ' (' + Math.round(100 * x.usage / x.maximum) + '%)' : ''}${x.error ? ' [VƯỢT/LỖI: ' + x.error + ']' : ''} — ${x.description || ''}`));
    if (j.status === 0) console.log('   lỗi: ' + redact((j.errors || []).join('; ')).slice(0, 200));
  } catch (e) { console.log(`\n== Lần ${i}: lỗi ${redact(e.message).slice(0, 120)}`); }
  if (i < rounds) await new Promise(r => setTimeout(r, 30_000));
}
