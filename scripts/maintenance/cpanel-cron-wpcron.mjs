// Thêm/gỡ 1 cron job của hosting chạy wp-cron web Lock mỗi 5 phút (cPanel API2 Cron). MODE=list|add|remove. Chỉ đụng đúng dòng có URL wp-cron của locknlockonline.com.
const MODE = ['add', 'remove'].includes(process.env.MODE) ? process.env.MODE : 'list';
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
if (!rawBase || !user || !token) throw new Error('Thiếu biến môi trường');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const H = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' };
const URLCRON = 'https://locknlockonline.com/wp-cron.php?doing_wp_cron';
const CMD = `curl -s -o /dev/null --max-time 120 "${URLCRON}" >/dev/null 2>&1`;
const red = t => String(t).split(user).join('<che>').replace(/\/home\d*\/[^/\s"]+/g, '/home/<che>');
async function api2(func, params = {}) { const u = new URL(`${b.origin}/json-api/cpanel`); for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Cron', cpanel_jsonapi_func: func, ...params })) u.searchParams.set(k, String(v)); const j = await (await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) })).json(); return j.cpanelresult; }
const list = async () => ((await api2('listcron')).data || []).filter(x => x.command);
let L = await list();
console.log(`Cron hiện có: ${L.length} dòng`); for (const x of L) console.log(`   ${x.minute} ${x.hour} ${x.day} ${x.month} ${x.weekday}  ${red(x.command).slice(0, 140)}`);
const mine = L.filter(x => x.command.includes('locknlockonline.com/wp-cron.php'));
if (MODE === 'add') {
  if (mine.length) { console.log('Đã có dòng wp-cron cho locknlockonline.com, không thêm.'); process.exit(0); }
  const r = await api2('add_line', { minute: '*/5', hour: '*', day: '*', month: '*', weekday: '*', command: CMD });
  L = await list(); const ok = L.some(x => x.command.includes('locknlockonline.com/wp-cron.php'));
  console.log(`Thêm cron: ${ok ? 'đạt' : 'LỖI ' + red(JSON.stringify(r?.error || r?.data)).slice(0, 200)}`); process.exit(ok ? 0 : 1);
}
if (MODE === 'remove') {
  for (const x of mine) { const r = await api2('remove_line', { linekey: x.linekey || x.line }); console.log('Gỡ dòng: ' + (r?.event?.result === 1 ? 'đạt' : 'LỖI')); }
}
