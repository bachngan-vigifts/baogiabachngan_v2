/** Local browser tests against the real CRM router and synthetic PGlite data. No production calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import { posRegisters,webStoreOrders } from "../../src/modules/sales/pos-schema.ts";
import { customerPayments, salesContracts } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupSepay(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url));
const out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-page-browser";
await mkdir(out, { recursive: true });
const a = await f.order("SEPAY_CRM_001"),
  b = await f.order("SEPAY_CRM_002"),
  c = await f.order("SEPAY_CRM_003"),
  mobileOrder = await f.order("SEPAY_CRM_MOBILE"),
  staleOrder = await f.order("SEPAY_CRM_STALE");
const unknown = await f.incoming("Khách kiểm thử gửi thiếu mã đơn", 100000, {
  transactionDate: "2026-11-08 15:00:00",
});
const manual = await f.incoming("Khoản đã được kế toán nhập trước", 100000, {
  transactionDate: "2026-11-08 14:00:00",
});
const manualId = crypto.randomUUID();
await f.db.insert(customerPayments).values({
  id: manualId,
  orderId: b.id,
  amount: 100000,
  paidAt: "2026-11-08",
  method: "transfer",
  reference: "BANK-MANUAL-TEST",
  createdBy: "mgr",
  createdAt: f.stamp,
});
const lost = await f.incoming(
  "Khoản thử mất phản hồi sau khi ghi thu",
  100000,
  { transactionDate: "2026-11-08 13:00:00" },
);
await f.incoming(
  'Nội dung không tin cậy <img src=x onerror="window.__sepayXss=1">',
  1000,
);
await f.incoming("Tài khoản chưa cấu hình", 50000, { accountNumber: "999999" });
let mobileEvent, staleEvent, supersede;
for (let i = 0; i < 5; i++) {
  const e = await f.incoming("Giao dịch phân trang " + i, 2000);
  if (i === 0) mobileEvent = e;
  if (i === 1) staleEvent = e;
  if (i === 2) supersede = e;
}
const options = {
  listError: false,
  loseNextConfirm: false,
  delayList: 0,
  delayDetailId: "",
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const isList = u.pathname === "/api/staff/sepay/transactions";
      if (
        options.delayDetailId &&
        u.pathname ===
          "/api/staff/sepay/transactions/" + options.delayDetailId &&
        req.method === "GET"
      )
        await new Promise((r) => setTimeout(r, 700));
      if (isList && options.delayList)
        await new Promise((r) => setTimeout(r, options.delayList));
      if (isList && options.listError) {
        res
          .writeHead(503, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "Lỗi mạng giả lập để kiểm thử" }));
        return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const r = await f.call(
        u.pathname.slice("/api/staff".length) + u.search,
        token ? "__Host-bn-session=" + token : "",
        req.method,
        chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined,
      );
      if (u.pathname.endsWith("/confirm") && options.loseNextConfirm) {
        options.loseNextConfirm = false;
        res.writeHead(503, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: "Mất phản hồi giả lập sau khi máy chủ xử lý",
          }),
        );
        return;
      }
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(r.data));
      return;
    }
    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    let body = await readFile(root + path);
    if (path.endsWith(".html"))
      body = Buffer.from(
        body
          .toString()
          .replace("<head>", '<head><meta name="bn-api" content="/api/staff">'),
      );
    res
      .writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".ttf")
              ? "font/ttf"
              : "text/html;charset=utf-8",
      })
      .end(body);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results = [];
async function pageFor(cookie, width, hash = "#/quotes") {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    locale: "vi-VN",
  });
  await context.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(origin + "/")
      ? r.continue()
      : r.abort(),
  );
  const user = (await f.call("/me", cookie)).data.user,
    token = cookie.split("=")[1];
  await context.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("bn-api-region-manual-off", "1");
      localStorage.setItem("bn-v2-session", token);
      localStorage.setItem(
        "bn-v2-session-profile",
        JSON.stringify({ session: token, user }),
      );
    },
    { user, token },
  );
  const p = await context.newPage(),
    errors = [],
    calls = [],
    assets = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (r.url().includes("/api/staff/sepay/"))
      calls.push({ url: r.url(), method: r.method() });
    if (/\/sepay\.(js|css)/.test(r.url())) assets.push(r.url());
  });
  await p.goto(origin + "/" + hash);
  await p.locator("#workspace").waitFor({ state: "visible" });
  return { p, context, errors, calls, assets };
}
async function detail(p, id) {
  await p.locator(`[data-open="${id}"]`).click();
  await p.locator("[data-detail] .sp-bank-amount").waitFor();
}
async function choose(p, no) {
  await p.locator('[data-order-search] input[name="orderQuery"]').fill(no);
  await p.locator("[data-order-search] button[type=submit]").click();
  await p.locator("[data-order-results] [data-choose]").first().click();
  await p.locator("[data-approval-form]").waitFor();
}
async function review(p) {
  const check = await p.locator(".sp-check").boundingBox(),
    input = await p.locator(".sp-check input").boundingBox();
  assert.ok(
    check.height < 100 && check.width > 150 && input.width <= 24,
    "confirmation checkbox and text must fit in a readable row",
  );
  await p
    .locator("[data-approval-form] textarea")
    .fill("Đã đối chiếu sao kê ngân hàng và xác nhận đúng khách, đúng đơn.");
  await p.locator("[data-approval-form] input[type=checkbox]").check();
  await p.locator("[data-approval-form] button[type=submit]").click();
  await p.locator("[data-confirm]").waitFor();
  assert.equal(await p.locator('[data-confirm]').textContent(),'Xác nhận gán khoản thu');
  assert.equal(await p.locator('[data-review]').evaluate(el=>document.activeElement===el),true);
  assert.equal(await p.locator('[data-confirm]').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
}
try {
  for (const width of [390,1440]) {
    const view=await pageFor(f.mgr,width,'#/sepay?limit=25');
    await view.p.locator('[data-list] table').waitFor();
    const selected=await view.p.locator('[data-open]').first().getAttribute('data-open');
    await view.p.locator('[data-open]').first().click();
    await view.p.locator('[data-detail] .sp-bank-amount').waitFor();
    const position=await view.p.locator('[data-detail] .sp-heading').evaluate(el=>({top:el.getBoundingClientRect().top,height:innerHeight}));
    await view.p.screenshot({path:out+'/open-detail-'+width+'.png'});
    assert.ok(position.top>=40&&position.top<200,JSON.stringify({width,...position}));
    assert.equal(await view.p.evaluate(()=>document.activeElement?.hasAttribute('data-detail')),true);
    const detailCalls=view.calls.length;
    await view.p.locator('[data-back-list]').click();
    assert.equal(await view.p.evaluate(()=>document.activeElement?.dataset.open),selected);
    assert.equal(view.calls.length,detailCalls,'returning to the selected row does not reload or write');
    assert.equal(await view.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(view.errors.length,0);
    results.push({case:width+'px long list reveals reconciliation and restores selected row focus',pass:true});
    await view.context.close();
  }

  const m = await pageFor(f.mgr, 1500);
  const p = m.p;
  assert.equal(m.calls.length, 0);
  assert.equal(
    m.assets.length,
    0,
    "SePay assets must stay lazy on other pages",
  );
  if (!(await p.locator(".side-nav [data-nav=sepay]").isVisible()))
    await p.locator("#nav-group-4 .nav-group-toggle").click();
  await p.locator(".side-nav [data-nav=sepay]").click();
  await p.locator("[data-list] table").waitFor();
  assert.equal(await p.locator("[data-open]").count(), 10);
  assert.equal(await p.locator("#view-sepay img").count(), 0);
  assert.equal(await p.evaluate(() => window.__sepayXss), undefined);
  await p.screenshot({ path: out + "/manager-desktop.png", fullPage: true });
  const before = (await f.db.select().from(customerPayments)).length;
  await detail(p, unknown.id);
  await choose(p, a.orderNo);
  await review(p);
  await p
    .locator("[data-detail]")
    .screenshot({ path: out + "/manager-confirmation.png" });
  assert.equal(
    (await f.db.select().from(customerPayments)).length,
    before,
    "preview must not write money",
  );
  await p.locator("[data-confirm]").evaluate((b) => {
    b.click();
    b.click();
  });
  await p.locator("[data-notice] .sp-success").waitFor();
  assert.equal((await f.db.select().from(customerPayments)).length, before + 1);
  assert.equal(
    m.calls.filter((r) => r.method === "POST" && r.url.endsWith("/confirm"))
      .length,
    1,
  );
  await detail(p, manual.id);
  await choose(p, b.orderNo);
  assert.equal(
    await p.locator("[data-approval-form] select").inputValue(),
    manualId,
  );
  await review(p);
  await p.locator("[data-confirm]").click();
  await p.locator("[data-notice] .sp-success").waitFor();
  assert.equal(
    (await f.db.select().from(customerPayments)).length,
    before + 1,
    "linking a manual receipt must not add money",
  );
  options.listError = true;
  await p.locator("[data-refresh]").click();
  await p.locator("[data-list] [role=alert]").waitFor();
  assert.equal(
    await p.locator("[data-stats] strong").first().textContent(),
    "—",
  );
  options.listError = false;
  await p.locator("[data-refresh]").click();
  await p.locator("[data-list] table").waitFor();
  await detail(p, lost.id);
  await choose(p, c.orderNo);
  await review(p);
  options.loseNextConfirm = true;
  await p.locator("[data-confirm]").click();
  await p.locator("[data-reload-detail]").waitFor();
  assert.equal(
    (
      await f.db
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.orderId, c.id))
    ).length,
    1,
  );
  await p.locator("[data-reload-detail]").click();
  await p.locator("[data-detail] .sp-matched").waitFor();
  assert.equal(await p.locator("[data-confirm]").count(), 0);
  await detail(p, staleEvent.id);
  await choose(p, staleOrder.orderNo);
  await review(p);
  options.delayDetailId = staleEvent.id;
  const pendingDetail = p.waitForRequest(
    (r) =>
      r.method() === "GET" &&
      r.url().includes("/sepay/transactions/" + staleEvent.id),
  );
  await p.locator("[data-confirm]").click();
  await pendingDetail;
  await p.locator(`[data-open="${supersede.id}"]`).evaluate((b) => b.click());
  await p.locator("[data-detail] .sp-bank-amount").waitFor();
  await p.waitForTimeout(900);
  assert.ok(
    (await p.locator("[data-detail]").textContent()).includes(
      supersede.providerId,
    ),
  );
  assert.equal(
    await p.locator("[data-notice] .sp-success").count(),
    0,
    "a success acknowledgement for another transaction must not appear in this detail",
  );
  options.delayDetailId = "";
  options.delayList = 700;
  await p.locator("[data-refresh]").click();
  await p.waitForTimeout(100);
  const oldCalls = m.calls.length;
  await p.evaluate(() => (location.hash = "#/quotes"));
  await p.waitForTimeout(1000);
  options.delayList = 0;
  assert.equal(
    await p.locator("#view-sepay").innerHTML(),
    "",
    "late list response must not repaint a closed private page",
  );
  assert.equal(m.calls.length, oldCalls, "leaving page must not poll SePay");
  assert.equal(m.errors.length, 0, m.errors.join("\n"));
  results.push({
    case: "manager create/link, double click, lost ACK, list error, lazy assets, no polling, XSS",
    pass: true,
  });
  await m.context.close();
  const account = await pageFor(f.accountant, 1500, "#/sepay");
  await account.p.locator("[data-list] table").waitFor();
  await detail(account.p, unknown.id);
  assert.equal(await account.p.locator("[data-order-search]").count(), 0);
  assert.ok(
    (await account.p.locator("[data-detail]").textContent()).includes(
      "Chỉ Manager",
    ),
  );
  const denied = await account.p.evaluate(
    async ({ id, orderId }) => {
      const r = await fetch(
        "/api/staff/sepay/transactions/" + id + "/confirm",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + localStorage.getItem("bn-v2-session"),
          },
          body: JSON.stringify({
            orderId,
            reason: "Thử quyền kế toán ghi nhận",
            confirmed: true,
          }),
        },
      );
      return r.status;
    },
    { id: unknown.id, orderId: a.id },
  );
  assert.equal(denied, 403);
  assert.equal(account.errors.length, 0, account.errors.join("\n"));
  await account.p.screenshot({
    path: out + "/accounting-desktop.png",
    fullPage: true,
  });
  results.push({
    case: "Accounting reads only, direct confirmation forbidden",
    pass: true,
  });
  await account.context.close();
  const mobile = await pageFor(f.mgr, 390, "#/sepay?limit=2");
  await mobile.p.locator("[data-list] table").waitFor();
  assert.equal(await mobile.p.locator("[data-open]").count(), 2);
  await mobile.p.locator("[data-next]").click();
  await mobile.p.waitForFunction(
    () =>
      new URLSearchParams(location.hash.split("?")[1]).get("offset") === "2",
  );
  await mobile.p.locator("[data-list] table").waitFor();
  assert.ok(
    await mobile.p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "mobile must not overflow horizontally",
  );
  await mobile.p.screenshot({
    path: out + "/manager-mobile.png",
    fullPage: true,
  });
  await mobile.p
    .locator(".crm-mobile-nav button")
    .filter({ hasText: "Tiền" })
    .click();
  await mobile.p
    .locator(".crm-nav-sheet [data-mobile-nav=sepay]")
    .waitFor({ state: "visible" });
  await mobile.p.locator(".crm-nav-sheet .icon-btn").click();
  await mobile.p
    .locator("[data-filters] [name=q]")
    .fill(mobileEvent.providerId);
  await mobile.p.locator("[data-filters] button[type=submit]").click();
  await mobile.p.locator(`[data-open="${mobileEvent.id}"]`).waitFor();
  await detail(mobile.p, mobileEvent.id);
  await choose(mobile.p, mobileOrder.orderNo);
  await review(mobile.p);
  await mobile.p.locator("[data-confirm]").scrollIntoViewIfNeeded();
  await mobile.p.screenshot({ path: out + "/manager-mobile-confirm.png" });
  await mobile.p.locator("[data-confirm]").click();
  await mobile.p.locator("[data-notice] .sp-success").waitFor();
  assert.equal(
    (
      await f.db
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.orderId, mobileOrder.id))
    )[0].amount,
    2000,
  );
  assert.equal(mobile.errors.length, 0, mobile.errors.join("\n"));
  results.push({
    case: "390px responsive layout, server pagination, footer menu and real confirmation",
    pass: true,
  });
  await mobile.context.close();
  await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
  const webSync=await f.call('/integrations/woocommerce/lock/order?token=test-lock-token','','POST',{id:21661,number:'21661',status:'processing',total:'100000',currency:'VND',payment_method_title:'Chuyển khoản ngân hàng (Quét mã QR)',date_paid_gmt:'2026-11-08T03:00:00',billing:{first_name:'Khách QR thử'},line_items:[{sku:'00123',name:'Ly',quantity:1,total:'100000',subtotal:'100000'}]});
  assert.equal(webSync.status,200,JSON.stringify(webSync.data));
  const [webOrder]=await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.externalId,'21661'));
  const receiptsBefore=(await f.db.select().from(customerPayments)).length;
  const webEvent=await f.incoming('BANK.000.DH21661.CT TEST',100000,{id:'qr-web-browser'});
  assert.equal(webEvent.status,'matched');
  for(const width of [1440,390]){
   const view=await pageFor(f.mgr,width,'#/sepay?q=qr-web-browser');
   await view.p.locator('[data-open]').waitFor();
   await detail(view.p,webEvent.id);
   await view.p.locator('[data-detail]').filter({hasText:'Đơn web 21661'}).waitFor();
   assert.equal(await view.p.locator('[data-order-search]').count(),0,'web payment cannot be reassigned to a CRM order');
   assert.equal(await view.p.locator('[data-confirm]').count(),0);
   const target='#/orders/web:'+webOrder.id;
   const link=view.p.locator('[data-detail] a').filter({hasText:'21661'});
   assert.equal(await link.getAttribute('href'),target);
   await view.p.screenshot({path:out+'/web-qr-'+width+'.png',fullPage:true});
   await link.click();await view.p.waitForURL('**/'+target);
   await view.p.locator('#view-order').filter({hasText:'21661'}).waitFor();
   assert.equal(view.errors.length,0,view.errors.join('\n'));
   assert.equal(await view.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await view.context.close();
  }
  assert.equal((await f.db.select().from(customerPayments)).length,receiptsBefore);
  results.push({case:'Lock QR links exact original website order on PC/mobile without another CRM receipt',pass:true});
  const pickerOrder=await f.order('SEPAY_PICK_ORDER',{status:'draft'});
  await f.db.insert(salesContracts).values({id:crypto.randomUUID(),contractNo:'HDKT_PICK_001',orderId:pickerOrder.id,legalEntity:'BN',status:'draft',value:100000,createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
  const pickerEvent=await f.incoming('Khoản cần chọn HĐKT',100000,{id:'picker-account-pending',accountNumber:'654321'});
  const receiptsAtPicker=(await f.db.select().from(customerPayments)).length;
  f.env.sepayReceiptAccounts=[];
  // Default list, debounced search, filters, pagination and disabled drafts on both widths.
  for(let i=0;i<22;i++) await f.order('FILTER_LIST_'+String(i).padStart(2,'0'));
  await f.order('FILTER_DRAFT',{status:'draft'});
  const searchRuns=[];
  for(const width of [1440,390]) for(let run=1;run<=3;run++) {
    const view=await pageFor(f.mgr,width,'#/sepay?q=picker-account-pending');
    await view.p.locator('[data-open]').waitFor();
    const started=performance.now();
    await detail(view.p,pickerEvent.id);
    await view.p.locator('[data-order-results] [data-choose]').first().waitFor();
    const defaultMs=performance.now()-started;
    const query=view.p.locator('[name=orderQuery]'), searchStarted=performance.now();
    await query.fill('NO_SUCH_DOCUMENT');
    await query.fill('FILTER_LIST');
    await view.p.waitForFunction(()=>{ const rows=[...document.querySelectorAll('[data-order-results] [data-choose]')]; return rows.length===20 && rows.every(row=>row.textContent.includes('FILTER_LIST')); });
    assert.equal(await view.p.locator('[data-order-results] [data-choose]').count(),20);
    searchRuns.push({width,run,defaultMs,typeaheadMs:performance.now()-searchStarted});
    const assign = view.p.locator('[data-order-results] [data-choose]').first();
    assert.ok((await assign.textContent()).includes('Chọn đơn này để gán khoản thu'));
    await assign.click();
    await view.p.locator('[data-account-block]').waitFor();
    assert.equal(await view.p.locator('[data-order-results] [aria-pressed=true]').count(),1);
    assert.equal(await view.p.locator('[data-preview]').evaluate(el=>document.activeElement===el),true);
    assert.equal(await view.p.locator('[data-preview]').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=70&&r.top<innerHeight/2;}),true,'preview is revealed after selection from 20 results');
    assert.equal(await view.p.getByRole('button',{name:'Gán khoản thu vào đơn này',exact:true}).isDisabled(),true);
    assert.equal(await view.p.locator('[data-approval-form]').count(),0);
    await view.p.screenshot({path:out+'/assignment-unapproved-'+width+'.png'});

    await view.p.locator('[data-order-offset="20"]').click();
    await view.p.waitForFunction(()=>document.querySelector('.sp-order-pages')?.textContent.includes('Trang 2'));
    assert.equal(await view.p.locator('[data-order-results] [data-choose]').count(),2);
    await query.fill('FILTER_DRAFT');
    const draftChoice=view.p.locator('[data-order-results] [data-choose]').filter({hasText:'FILTER_DRAFT'});
    await draftChoice.waitFor(); assert.equal(await draftChoice.isEnabled(),true);
    await draftChoice.click(); await view.p.locator('[data-account-block]').waitFor();
    await view.p.locator('[name=eligibility]').selectOption('eligible');
    await view.p.locator('[data-order-results] [data-choose]').filter({hasText:'FILTER_DRAFT'}).waitFor();
    await view.p.locator('[name=eligibility]').selectOption('active');
    await query.fill('HDKT_PICK_001');
    await view.p.locator('[name=source]').selectOption('contract');
    await view.p.locator('[data-order-results] [data-choose]').filter({hasText:'HDKT_PICK_001'}).click();
    await view.p.locator('[data-account-block]').waitFor();
    assert.equal(await view.p.locator('[data-preview] h3').textContent(),'HDKT_PICK_001');
    assert.equal(await view.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(view.errors.length,0,view.errors.join('\n'));
    await view.p.screenshot({path:out+'/document-search-'+width+'.png',fullPage:true});
    await view.p.locator('[data-clear-orders]').click();
    await view.p.locator('[data-order-results] [data-choose]').first().waitFor();
    assert.equal(await query.inputValue(),'');
    assert.equal(await view.p.locator('[data-preview] h3').count(),0);
    await view.context.close();
  }
  await writeFile(out+'/search-timing.json',JSON.stringify(searchRuns,null,2));
  results.push({case:'default document list, typeahead, filters, pagination and manually selectable CRM drafts on PC/mobile',pass:true});
  const picker=await pageFor(f.mgr,390,'#/sepay?q=picker-account-pending');
  await picker.p.locator('[data-open]').waitFor();await detail(picker.p,pickerEvent.id);
  await picker.p.locator('[data-order-search]').waitFor();
  await picker.p.locator('[data-order-search] input[name="orderQuery"]').fill('HDKT_PICK_001');
  await picker.p.locator('[data-order-search] button[type=submit]').click();
  await picker.p.locator('[data-order-results] [data-choose]').first().click();
  await picker.p.locator('[data-account-block]').waitFor();
  assert.equal(await picker.p.locator('[data-preview] h3').textContent(),'HDKT_PICK_001');
  assert.equal(await picker.p.locator('[data-approval-form]').count(),0);
  assert.equal(await picker.p.locator('[data-confirm]').count(),0);
  assert.equal((await f.confirm(pickerEvent.id,f.choice(pickerOrder.id))).status,409);
  assert.equal((await f.db.select().from(customerPayments)).length,receiptsAtPicker);
  await picker.p.screenshot({path:out+'/picker-unapproved-390.png',fullPage:true});
  f.env.sepayReceiptAccounts=['654321'];
  await picker.p.locator('[data-reload-detail]').click();
  await picker.p.locator('[data-order-search]').waitFor();await choose(picker.p,'HDKT_PICK_001');
  assert.equal(await picker.p.getByRole('button',{name:'Xem lại để gán khoản thu',exact:true}).isEnabled(),true);
  await picker.p.locator('[data-preview]').filter({hasText:'Đơn/HĐKT còn nháp'}).waitFor();
  await review(picker.p);await picker.p.locator('[data-confirm]').click();
  await picker.p.locator('[data-notice] .sp-success').waitFor();
  const picked=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,pickerOrder.id));
  assert.equal(picked.length,1);assert.equal(picked[0].amount,100000);
  assert.equal(picker.errors.length,0,picker.errors.join('\n'));
  await picker.context.close();
  results.push({case:'unapproved account can search/select HĐKT and inspect debt; only after approval can Manager post once',pass:true});
  f.env.sepayReceiptAccounts=[];
  for (const width of [1440,390]) {
    const order=await f.order('CONFIGURED_BANK_'+width,{status:'draft'});
    const transfer=await f.incoming(order.orderNo,30000);
    const view=await pageFor(f.mgr,width,'#/sepay?q='+transfer.providerId);
    await view.p.locator('[data-open]').waitFor(); await detail(view.p,transfer.id);
    await choose(view.p,order.orderNo);
    assert.equal(await view.p.locator('[data-account-block]').count(),0);
    await review(view.p); await view.p.locator('[data-confirm]').click();
    await view.p.locator('[data-notice] .sp-success').waitFor();
    const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id));
    assert.equal(receipts.length,1);assert.equal(receipts[0].amount,30000);
    assert.equal(view.errors.length,0,view.errors.join('\n'));
    await view.p.screenshot({path:out+'/company-bank-receipt-'+width+'.png'});
    await view.context.close();
  }
  results.push({case:'active configured company bank creates one CRM draft receipt on PC/mobile without enabling automatic matching',pass:true});
  const emp = await pageFor(f.emp, 1100, "#/sepay");
  await emp.p.waitForTimeout(500);
  assert.ok(!emp.p.url().includes("#/sepay"));
  assert.equal(emp.calls.length, 0);
  assert.equal(emp.assets.length, 0);
  assert.equal(emp.errors.length, 0, emp.errors.join("\n"));
  results.push({
    case: "Sales cannot navigate to or load private SePay page",
    pass: true,
  });
  await emp.context.close();
  // The permission matrix controls both the API and desktop/mobile navigation.
  const employee=(await f.call('/me',f.emp)).data.user;
  const permissionData=(await f.call('/permissions',f.mgr)).data;
  const position=permissionData.positions.find(p=>p.id===employee.positionId);
  const definition=permissionData.catalog.find(p=>p.key==='page.sepay');
  assert.ok(definition);
  const manager=await pageFor(f.mgr,1440,'#/permissions');
  const region=manager.p.locator('#view-permissions');
  const accessBox=region.getByRole('checkbox',{name:definition.label+' – '+position.name,exact:true});
  await accessBox.waitFor();
  assert.equal(await accessBox.isChecked(),false);
  const managerPosition=permissionData.positions.find(p=>p.id==='manager');
  const managerBox=region.getByRole('checkbox',{name:definition.label+' – '+managerPosition.name,exact:true});
  assert.equal(await managerBox.isChecked(),true);
  assert.equal(await managerBox.isDisabled(),true);
  async function savePermission(){
    const response=manager.p.waitForResponse(r=>r.url().includes('/permissions/positions/'+position.id)&&r.request().method()==='PUT');
    await region.getByRole('button',{name:/^Lưu thay đổi/}).click();
    assert.equal((await response).status(),200);
    await manager.p.waitForFunction(()=>Array.from(document.querySelectorAll('#view-permissions button')).some(b=>b.textContent==='Lưu thay đổi'&&b.disabled));
  }
  await accessBox.check();await savePermission();
  await accessBox.scrollIntoViewIfNeeded();
  await manager.p.screenshot({path:out+'/sepay-permission-matrix.png',fullPage:true});
  const record=await f.incoming('Khoản kiểm thử quyền xem SePay',100000,{id:'permission-browser'});
  for(const width of [1440,390]){
    const view=await pageFor(f.emp,width,'#/sepay?q=permission-browser');
    await view.p.locator('[data-list] table').waitFor();
    assert.equal(await view.p.locator('a.nav[data-nav=sepay]').evaluate(el=>el.hidden),false);
    await detail(view.p,record.id);
    assert.equal(await view.p.locator('[data-order-search]').count(),0,'view permission cannot expose receipt assignment');
    assert.equal(await view.p.locator('[data-confirm]').count(),0);
    await view.p.locator('.sp-readonly').filter({hasText:'Chỉ Manager'}).waitFor();
    if(width===390){
      await view.p.locator('.crm-mobile-nav button').filter({hasText:'Tiền'}).click();
      await view.p.locator('.crm-nav-sheet [data-mobile-nav=sepay]').waitFor({state:'visible'});
      await view.p.locator('.crm-nav-sheet .icon-btn').click();
    }
    await view.p.screenshot({path:out+'/sepay-permission-viewer-'+width+'.png',fullPage:true});
    assert.equal(await view.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(view.errors,[]);
    await view.context.close();
  }
  await accessBox.uncheck();await savePermission();
  const revokedView=await pageFor(f.emp,390,'#/sepay');
  assert.ok(!revokedView.p.url().includes('#/sepay'));
  assert.equal(revokedView.calls.length,0);
  assert.equal(revokedView.assets.length,0);
  assert.equal(await revokedView.p.locator('a.nav[data-nav=sepay]').evaluate(el=>el.hidden),true);
  assert.deepEqual(revokedView.errors,[]);
  await revokedView.context.close();
  assert.deepEqual(manager.errors,[]);
  await manager.context.close();
  results.push({case:'Manager toggles SePay in the real permissions matrix: granted Sale sees PC/mobile menu and read-only page; revocation hides/blocks it without granting confirmation',pass:true});
  await writeFile(
    out + "/browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
