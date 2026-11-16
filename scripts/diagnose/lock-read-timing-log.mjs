// CHỈ ĐỌC: in log thời gian đặt hàng (wp-content/lnl-logs/checkout-timing.log). Log không chứa dữ liệu khách. TAIL = số dòng cuối.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim(), docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const u = new URL(`${b.origin}/execute/Fileman/get_file_content`); u.searchParams.set('dir', `${docroot}/wp-content/lnl-logs`); u.searchParams.set('file', 'checkout-timing.log');
const j = await (await fetch(u, { headers: { Authorization: `cpanel ${user}:${token}` } })).json().catch(() => null);
const t = j && j.status ? String(j.data?.content || '') : null;
if (t === null) { console.log('Chưa có log (hoặc không đọc được): ' + ((j && j.errors) || []).join('; ').replace(user, '<che>').slice(0, 120)); process.exit(0); }
const L = t.trim().split('\n'); console.log(`Log có ${L.length} dòng; ${Number(process.env.TAIL || 20)} dòng cuối:`);
for (const l of L.slice(-Number(process.env.TAIL || 20))) console.log(l.replace(/\/home\d*\/[^/"]+/g, '/home/<che>').slice(0, 1500));
const web = await fetch('https://locknlockonline.com/wp-content/lnl-logs/checkout-timing.log'); console.log(`Truy cập log từ web: HTTP ${web.status} (phải là 403/404)`);
