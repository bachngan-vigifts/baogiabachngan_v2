/** Ảnh chụp + đo các lỗi giao diện điện thoại (thanh trên cùng, nút tin nhắn, popup quét mã, ô lọc Lợi nhuận, chấm Duyệt).
 * PGlite + dữ liệu thử nghiệm, không gọi production. UI_ROOT để chụp bản trước/sau; OUT là thư mục ảnh. */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup(), root = process.env.UI_ROOT || fileURLToPath(new URL('../../trial-ui/', import.meta.url)), out = process.env.OUT || '/tmp/mobile-chrome';
await mkdir(out, { recursive: true });
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
const server = createServer(async (req, res) => { try { const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/staff/')) { const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined; const bearer = req.headers.authorization?.replace(/^Bearer /, '') || ''; const r = await f.call(url.pathname.slice('/api/staff'.length) + url.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body); res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return; }
  let data = await readFile(root + (url.pathname === '/' ? 'index.html' : url.pathname)); if (url.pathname === '/') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(data); } catch { res.writeHead(404).end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'vi-VN' });
await ctx.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
await ctx.addInitScript(({ token, user }) => { try { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); } catch {} window.__bnBreakConfig = { firstMs: 9e9, secondMs: 9e9 }; }, { token, user });
const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
const metrics = {};
const topbar = () => page.evaluate(() => { const t = document.querySelector('#breadcrumb'), b = document.querySelector('#page-back'), a = document.querySelector('#approval-launcher-count');
  return { title: t.textContent, titleVisible: Math.round(t.getBoundingClientRect().width), titleNeeds: t.scrollWidth, titleCut: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1, topbarHeight: Math.round(document.querySelector('.topbar').getBoundingClientRect().height), back: Math.round(b.getBoundingClientRect().width), backLabel: b.getAttribute('aria-label'), approvalBadgeShown: !!a && !a.hidden && a.getBoundingClientRect().width > 0, approvalBadgeText: a?.textContent }; });
const coveredByChat = () => page.evaluate(() => { const c = document.querySelector('#chat-launcher'); if (!c || c.hidden) return []; const cs = getComputedStyle(c); if (cs.display === 'none' || +cs.opacity < .1 || cs.visibility === 'hidden') return ['(ẩn)']; const fr = c.getBoundingClientRect(); return [...document.querySelectorAll('main button, main a.btn, main input, main select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > fr.left && r.left < fr.right && r.bottom > fr.top && r.top < fr.bottom; }).map(e => (e.textContent || e.placeholder || '').trim().slice(0, 20)); });
async function go(hash) { await page.goto('about:blank'); await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(900); }
// 1, 4: thanh trên cùng, chấm Duyệt.
for (const hash of ['#/quotes', '#/deliveries', '#/pos', '#/profit']) { await go(hash); metrics[hash + ' topbar'] = await topbar(); await page.screenshot({ path: `${out}/top-${hash.slice(2)}.png`, clip: { x: 0, y: 0, width: 390, height: 120 } }); }
// 2: nút tin nhắn. Lịch giao hàng cuộn tới hàng "Hôm nay"; khi đang cuộn xuống nút phải tránh đường.
await go('#/deliveries');
// Trang cuộn trong .main (không phải window). Cuộn xuống như ngón tay vuốt cho tới khi thấy nút "Hôm nay" ở nửa dưới màn hình.
await page.mouse.move(200, 400);
for (let i = 0; i < 12; i++) { const y = await page.evaluate(() => [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'Hôm nay')?.getBoundingClientRect().top ?? 0); if (y < 720) break; await page.mouse.wheel(0, 60); await page.waitForTimeout(120); }
await page.waitForTimeout(300);
metrics['#/deliveries chat while scrolling'] = await coveredByChat(); await page.screenshot({ path: `${out}/chat-deliveries-scrolling.png` });
await page.mouse.wheel(0, -60); await page.waitForTimeout(500); metrics['#/deliveries chat after scrolling back up'] = await coveredByChat(); await page.screenshot({ path: `${out}/chat-deliveries-up.png` });
await go('#/home'); metrics['#/home chat on load'] = await coveredByChat(); await page.screenshot({ path: `${out}/chat-home-load.png` });
await page.mouse.move(200, 400); for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); } await page.waitForTimeout(500); metrics['#/home chat at page end'] = await coveredByChat(); await page.screenshot({ path: `${out}/chat-home-end.png` });
// 3: popup quét mã (máy không có camera → hiện cả 2 nút).
await go('#/pos'); const scan = page.locator('#view-pos button', { hasText: /Quét mã|barcode/i }).first();
const scanButton = (await page.locator('#view-pos [aria-label*="Quét"]').count()) ? page.locator('#view-pos [aria-label*="Quét"]').first() : scan;
await scanButton.click(); await page.locator('dialog[open]').waitFor(); await page.getByRole('button', { name: 'Nhập mã thủ công' }).waitFor();
metrics['#/pos scan buttons'] = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const bs = [...d.querySelectorAll('button')].filter(b => /Đóng camera|Nhập mã thủ công/.test(b.textContent)).map(b => b.getBoundingClientRect()); return bs.length === 2 ? { gapX: Math.round(bs[1].left - bs[0].right), gapY: Math.round(bs[1].top - bs[0].bottom), widths: bs.map(r => Math.round(r.width)), heights: bs.map(r => Math.round(r.height)) } : null; });
await page.locator('dialog[open]').screenshot({ path: `${out}/pos-scan-popup.png` });
// 5: ô lọc Phân tích lợi nhuận.
await go('#/profit'); metrics['#/profit selects'] = await page.evaluate(() => [...document.querySelectorAll('.pf-filters select')].map(s => ({ id: s.id, text: s.selectedOptions[0]?.textContent, cut: s.scrollWidth > s.clientWidth + 1 || (() => { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(s).font; return c.measureText(s.selectedOptions[0]?.textContent || '').width + 36 > s.clientWidth; })(), width: Math.round(s.getBoundingClientRect().width) })));
await page.locator('.pf-head').screenshot({ path: `${out}/profit-filters.png` });
metrics.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); metrics.errors = errors.filter(e => !/localStorage/.test(e));
await writeFile(`${out}/metrics.json`, JSON.stringify(metrics, null, 1)); console.log(JSON.stringify(metrics, null, 1));
await browser.close(); server.close(); process.exit(0);
