// Đổi cron wp-cron của web Lock: dòng "curl https://locknlockonline.com/wp-cron.php" (mỗi phút, vòng qua Cloudflare) -> chạy trực tiếp "php -q wp-cron.php" trong thư mục web Lock, tần suất MINUTE (mặc định */3).
// Sau đó gỡ dòng chạy mỗi giờ cũ NẾU nó chạy đúng thư mục web Lock (trùng việc). MODE=apply|revert. revert: trả về như cũ (curl mỗi phút + php mỗi giờ phút 31).
const MODE = process.env.MODE === 'revert' ? 'revert' : 'apply', MINUTE = (process.env.MINUTE || '*/3').trim();
if (!/^\*\/[2-9]$|^\*\/1[0-5]$/.test(MINUTE)) throw new Error('MINUTE không hợp lệ');
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!docroot.startsWith('/') || docroot.includes('..') || /[;&|`$'" ]/.test(docroot)) throw new Error('LOCKNLOCK_DOCROOT không hợp lệ');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const H = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' };
const red = t => String(t).split(docroot).join('<thư mục web Lock>').split(user).join('<che>').replace(/\/home\d*\/[^/\s"]+/g, '/home/<che>');
async function api2(func, params = {}) { const u = new URL(`${b.origin}/json-api/cpanel`); for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Cron', cpanel_jsonapi_func: func, ...params })) u.searchParams.set(k, String(v)); return (await (await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) })).json()).cpanelresult; }
const list = async () => ((await api2('listcron')).data || []).filter(x => x.command);
const show = (t, L) => { console.log(t); for (const x of L) console.log(`   ${x.minute} ${x.hour} ${x.day} ${x.month} ${x.weekday}  ${red(x.command).slice(0, 130)}`); };
const CURL = '/usr/bin/curl --fail --silent --show-error --max-time 50 https://locknlockonline.com/wp-cron.php >/dev/null 2>&1';
const PHP = `cd ${docroot}; /bin/nice -n15 /usr/bin/php -q wp-cron.php >/dev/null 2>&1`;
let L = await list(); show('Trước:', L);
const edit = (x, minute, hour, command) => api2('edit_line', { linekey: x.linekey, line: x.line, minute, hour, day: '*', month: '*', weekday: '*', command });
if (MODE === 'apply') {
  const curl = L.filter(x => x.command.includes('https://locknlockonline.com/wp-cron.php'));
  if (curl.length !== 1) { console.log(`DỪNG: cần đúng 1 dòng curl wp-cron Lock, thấy ${curl.length}`); process.exit(3); }
  await edit(curl[0], MINUTE, '*', PHP);
  L = await list();
  const hourly = L.filter(x => x.command === PHP && x.minute !== MINUTE);
  for (const x of hourly) { const r = await api2('remove_line', { linekey: x.linekey, line: x.line }); console.log('Gỡ dòng mỗi giờ trùng việc: ' + (r?.event?.result === 1 ? 'đạt' : 'LỖI')); }
  if (!hourly.length) console.log('Dòng chạy mỗi giờ KHÔNG trỏ đúng thư mục web Lock (hoặc không có) -> giữ nguyên.');
} else {
  const mine = L.filter(x => x.command === PHP);
  if (mine.length) await edit(mine[0], '*', '*', CURL);
  await api2('add_line', { minute: '31', hour: '*', day: '*', month: '*', weekday: '*', command: PHP });
}
L = await list(); show('Sau:', L);
const ok = MODE === 'apply' ? L.some(x => x.command === PHP && x.minute === MINUTE) && !L.some(x => x.command.includes('https://locknlockonline.com/wp-cron.php')) : L.some(x => x.command === CURL);
console.log(ok ? 'KẾT QUẢ: ĐẠT' : 'KẾT QUẢ: LỖI'); process.exit(ok ? 0 : 1);
