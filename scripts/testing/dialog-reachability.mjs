/** Tìm chức năng bị mất trong popup khổ 16:9: mở popup thật trên app thật (PGlite giả, không dữ liệu production),
 * so sánh nút/ô nhập BẤM ĐƯỢC khi bật khung ngang (LAYOUT=on) và khi tắt bộ điều khiển khung (LAYOUT=off). */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup(), off = process.env.LAYOUT === 'off';
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(url.pathname.slice('/api/staff'.length) + url.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return;
    }
    if (off && url.pathname === '/dialog-layout.js') { res.setHeader('content-type', 'text/javascript'); res.end('export function fitDialog(){return false}export function installDialogLayouts(){return()=>{}}'); return; }
    let data = await readFile(root + (url.pathname === '/' ? 'index.html' : url.pathname));
    if (url.pathname === '/' || url.pathname === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch (e) { res.writeHead(404).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const [W, H] = (process.env.VIEWPORT || '1366x768').split('x').map(Number);
const routes = (process.env.ROUTES || '#/care #/cash #/cashbook #/contracts #/customers #/deliveries #/early-requests #/feedback #/finance #/flow #/inventory #/kho #/monthly-reports #/orders #/packing #/payroll #/permissions #/pos #/product-custody #/products #/profit #/purchases #/quotes #/receivables #/receiving #/shift-reports #/staff #/stock-moves #/stock-requests #/stocktake #/store-reports #/suppliers #/tasks #/transfers #/weekly-reports').split(' ');
const OPENER = /./;
const SKIP = /xoá|xóa|huỷ|hủy|đăng xuất|xuất excel|^in |tải file|đồng bộ|duyệt|chốt|gửi|trang (trước|sau|tiếp)|^[‹›«»]$/i;
// Probe chạy trong trang: liệt kê điều khiển nhìn thấy + kiểm tra có cuộn tới và bấm trúng được không.
const probe = () => {
  const d = [...document.querySelectorAll('dialog[open],.sup-drawer:not([hidden])')].pop(); if (!d) return null;
  const vis = e => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; for (let p = e; p && p !== d; p = p.parentElement) if (getComputedStyle(p).display === 'none' || p.hidden) return false; return true; };
  const key = e => [e.tagName.toLowerCase(), e.name || e.id || '', (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 30)].join('|');
  const hit = e => { e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return 'size0'; const x = r.x + r.width / 2, y = r.y + r.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'offscreen'; const h = document.elementFromPoint(x, y); if (!h) return 'nohit'; if (h === e || e.contains(h) || h.contains(e) || h.closest('label')?.contains(e) || (h.closest('label') && h.closest('label').control === e)) return 'ok'; return 'covered:' + (h.className || h.tagName).toString().slice(0, 40); };
  const controls = [...d.querySelectorAll('button,input:not([type=hidden]),select,textarea,a.btn,[role=tab]')].filter(vis);
  const out = {}; for (const e of controls) { const k = key(e); if (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file') { const l = e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)); out[k] = l && vis(l) ? hit(l) : hit(e); } else out[k] = hit(e); }
  const r = d.getBoundingClientRect();
  return { title: (d.querySelector('h2,h3,[class*=title]')?.textContent || d.getAttribute('aria-label') || d.id || d.className).trim().slice(0, 50), cls: d.className, landscape: d.classList.contains('landscape-dialog'), size: [Math.round(r.width), Math.round(r.height)], controls: out };
};
const result = {};
try {
  for (const hash of routes) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await ctx.addInitScript(({ token, user }) => { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); window.confirm = () => false; }, { token, user });
    const page = await ctx.newPage(); page.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600);
    const openers = await page.evaluate(([o, s]) => [...document.querySelectorAll('main .view:not([hidden]) button, main .view:not([hidden]) a.btn')].filter(b => b.offsetParent && !b.disabled && new RegExp(o, 'i').test((b.textContent || b.title || '').trim()) && !new RegExp(s, 'i').test((b.textContent || b.title || '').trim())).map((b, i) => { b.dataset.probeOpener = String(i); return (b.textContent || b.title).trim().replace(/\s+/g, ' ').slice(0, 40); }), [OPENER.source, SKIP.source]);
    if (process.env.DEBUG) console.error(hash, openers.join(" · "));
    const seen = new Set();
    for (let i = 0; i < openers.length && i < 45; i++) {
      if (seen.has(openers[i])) continue; seen.add(openers[i]);
      try {
        await page.goto('about:blank'); await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500);
        await page.evaluate(([o, s]) => { [...document.querySelectorAll('main .view:not([hidden]) button, main .view:not([hidden]) a.btn')].filter(b => b.offsetParent && !b.disabled && new RegExp(o, 'i').test((b.textContent || b.title || '').trim()) && !new RegExp(s, 'i').test((b.textContent || b.title || '').trim())).forEach((b, i) => b.dataset.probeOpener = String(i)); }, [OPENER.source, SKIP.source]);
        const b = page.locator(`[data-probe-opener="${i}"]`); if (!(await b.count())) continue;
        await b.first().click({ timeout: 3000 }); await page.waitForTimeout(700);
        const p = await page.evaluate(probe); if (p) result[`${hash} › ${openers[i]}`] = p;
      } catch (e) { if (process.env.DEBUG) console.error("  !", openers[i], e.message.split("\n")[0]); }
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(process.env.OUT || '/dev/stdout', JSON.stringify(result, null, 1));
console.log('OK', Object.keys(result).length, 'popup', off ? '(tắt khung)' : '(khung 16:9)');
