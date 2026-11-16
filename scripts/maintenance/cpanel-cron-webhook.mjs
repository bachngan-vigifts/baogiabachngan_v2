// Đổi tần suất cron webhook runner của Minh Long (dòng có "minhlong-webhook-runner.php"). MINUTE=*/3 (mặc định) hoặc * để trả về mỗi phút. Chỉ sửa trường phút của đúng dòng đó, giữ nguyên lệnh.
const MINUTE = (process.env.MINUTE || '*/3').trim();
if (!/^(\*|\*\/[1-9]|\*\/1[0-5])$/.test(MINUTE)) throw new Error('MINUTE không hợp lệ');
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const H = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' };
const red = t => String(t).split(user).join('<che>').replace(/\/home\d*\/[^/\s"]+/g, '/home/<che>');
async function api2(func, params = {}) { const u = new URL(`${b.origin}/json-api/cpanel`); for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Cron', cpanel_jsonapi_func: func, ...params })) u.searchParams.set(k, String(v)); return (await (await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) })).json()).cpanelresult; }
const show = L => { for (const x of L) console.log(`   ${x.minute} ${x.hour} ${x.day} ${x.month} ${x.weekday}  ${red(x.command).slice(0, 120)}`); };
let L = ((await api2('listcron')).data || []).filter(x => x.command); console.log('Trước:'); show(L);
const t = L.filter(x => x.command.includes('minhlong-webhook-runner.php'));
if (t.length !== 1) { console.log(`DỪNG: tìm thấy ${t.length} dòng webhook runner (cần đúng 1).`); process.exit(3); }
const x = t[0];
if (x.minute === MINUTE) { console.log('Đã đúng tần suất, không đổi.'); process.exit(0); }
const r = await api2('edit_line', { linekey: x.linekey, line: x.line, minute: MINUTE, hour: x.hour, day: x.day, month: x.month, weekday: x.weekday, command: x.command });
L = ((await api2('listcron')).data || []).filter(y => y.command); console.log('Sau:'); show(L);
const ok = L.some(y => y.command === x.command && y.minute === MINUTE) && L.length === ((await api2('listcron')).data || []).filter(y => y.command).length;
console.log(ok ? `KẾT QUẢ: đã đổi webhook runner sang phút "${MINUTE}"` : 'LỖI: ' + red(JSON.stringify(r?.error || r?.data)).slice(0, 200)); process.exit(ok ? 0 : 1);
