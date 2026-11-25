import {checkHeaderMenu} from './helpers/pos-header-menu-checks.mjs';
import assert from "node:assert/strict";
import {checkLineMenu} from './helpers/pos-line-menu-checks.mjs';
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { postMoves } from "../../src/modules/inventory/api/ledger.ts";
import { eq } from "drizzle-orm";
import { posPaymentRequests } from "../../src/modules/sales/pos-schema.ts";
import { salesOrders, customerPayments } from "../../src/modules/sales/schema.ts";
import { products, productPrices, productStock } from "../../src/modules/catalog/schema.ts";
import { posRegisters, webStoreOrders } from "../../src/modules/sales/pos-schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setup({productBrand:'Minh Long'});
await f.db.update(posRegisters).set({name:'CỬA HÀNG MINH LONG'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm Jas Lys — bộ sưu tập gốm sứ hoa văn dành cho khách hàng doanh nghiệp, màu trắng ngà',unit:'Cái'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
await f.db.insert(products).values([{ sku: "00456", name: "Ly thứ hai", brand:"Minh Long", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { sku: "00789", name: "Ly hết hàng", brand:"Minh Long", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }]);
await f.db.insert(productPrices).values([{ sku: "00456", policyId: "retail-vat", price: 54e3 }, { sku: "00789", policyId: "retail-vat", price: 54e3 }]);
await f.db.insert(productStock).values({ sku: "00456", warehouseId: "pos-wh", quantity: 50, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00456", warehouseId: "pos-wh", qty: 50, kind: "opening", refType: "opening", refId: "scan-fixture" }]));
for (let i = 0; i < 20; i++) {
  const sku = "P" + i;
  await f.db.insert(products).values({ sku, name: "Bộ sản phẩm tên rất dài để kiểm tra bố cục bảng " + i, brand:"Minh Long", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.insert(productPrices).values({ sku, policyId: "retail-vat", price: 108e3 });
  await f.db.insert(productStock).values({ sku, warehouseId: "pos-wh", quantity: 100, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku, warehouseId: "pos-wh", qty: 100, kind: "opening", refType: "opening", refId: "workspace-" + sku }]));
}
await f.db.insert(webStoreOrders).values({id:'ref-web-1',source:'minhlong',externalId:'REF-WEB-001',orderNo:'WEB_REF_001',registerId:f.registerId,status:'processing',customerName:'Khách web kiểm thử',total:80000,lines:'[]',orderedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"><\/script><button id="approval-launcher" class="approval-launcher" aria-label="Cần duyệt: 42 việc">42</button><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';location.hash='#/pos';window.notices=[];window.confirmCount=0;window.printCount=0;new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.tagName==='IFRAME')n.contentWindow.print=()=>{window.printCount++;n.contentWindow.dispatchEvent(new n.contentWindow.Event('afterprint'));};}).observe(document.body,{childList:true});
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>window.notices.push(message),confirmBox:async()=>{window.confirmCount++;return window.confirmAnswer!==false;},go:hash=>location.hash=hash});await pos.load();window.ready=true;
<\/script>`;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"), path = u.pathname;
    if (path.startsWith("/api/")) {
      let body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ path: path.slice(4), method: req.method, body });
      if(path==='/api/pos/ghn/locations'){res.setHeader('content-type','application/json');res.end(JSON.stringify({locations:[{id:body.districtId?'3':body.provinceId?'2':'1',name:body.districtId?'Phường kiểm thử':body.provinceId?'Quận kiểm thử':'Cần Thơ'}]}));return;}
      if (path === "/api/pos/catalog" && u.searchParams.get("q")) await new Promise((r2) => setTimeout(r2, u.searchParams.get("q") === "00123" ? 350 : 100));
      const r = await f.call(path.slice(4) + u.search, f.mgr, req.method, body);
      if (path === "/api/pos/qr" && r.status === 200) qrResults.push(r.data);
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.data));
      return;
    }
    if (path === "/barcode-camera.js") {
      res.setHeader("content-type", "text/javascript");
      res.end("export async function startBarcodeCamera(video,onCode){window.cameraCode=onCode;return {stop(){}};}");
      return;
    }
    res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".ttf") ? "font/ttf" : "text/html");
    res.end(path === "/" ? html : await readFile(root + path));
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-reference";
await mkdir(shot, { recursive: true });
const results=[];
try {
  for(const [width,height] of (process.env.POS_MENU_MOBILE_ONLY?[[390,844],[320,640]]:[[1853,1268],[2214,1497],[1812,1000],[1440,900],[1417,1017],[1280,800],[1024,768],[969,954],[1033,1017],[390,844]])){
    const context=await browser.newContext({viewport:{width,height},locale:'vi-VN'});
    await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    try {
      await page.goto(origin);await page.waitForFunction(()=>window.ready);
      assert.equal(await page.locator('#approval-launcher').isVisible(),false,'approval bell cannot cover POS search');
      await page.evaluate(()=>{document.querySelector('#view-pos').hidden=true;});assert.equal(await page.locator('#approval-launcher').isVisible(),true,'launcher stays available outside POS');
      await page.evaluate(()=>{document.querySelector('#view-pos').hidden=false;document.querySelector('#approval-launcher').hidden=false;});assert.equal(await page.locator('#approval-launcher').isVisible(),false,'background refresh cannot reveal bell on POS');
      await checkHeaderMenu(page,shot+`/${width}-header-menu.png`);
      const desktop=width>850,input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});
      await page.screenshot({path:shot+`/${width}-empty.png`});
      if(desktop) {
        assert.equal(await page.locator('.pos-ref-modes button').count(),3);
        assert.equal(await page.locator('.pos-head').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(0, 112, 244)');
      }
      await input.fill('00123');await page.locator('.pos-product[data-sku="00123"]').waitFor();await input.press('Enter');
      await page.waitForFunction(()=>document.querySelector('.pos-qty input'));
      const qty=page.locator('.pos-qty input').first();
      for(const expected of ['2','3']){
        await input.fill('00123');
        await page.locator('.pos-product[data-sku="00123"]').waitFor();
        await page.locator('.pos-product[data-sku="00123"]').click();
        await page.waitForFunction(expected=>document.querySelector('.pos-qty input')?.value===expected,expected);
        assert.equal(await input.inputValue(),'','clicking a result clears the scan field');
        assert.equal(await input.evaluate(n=>document.activeElement===n),true,'ready for the next scan');
        assert.equal(await page.locator('.pos-line:not(.pos-gift-line)').count(),1,'repeated clicks increment one line');
      }
      await page.waitForTimeout(400);
      assert.equal(await input.inputValue(),'','old debounced searches cannot restore a consumed query');
      if(desktop){
        const below=await page.locator('.pos-line').first().evaluate(n=>{const [code,quantity,unit]=['.pos-line-code','.pos-qty','.pos-ref-unit'].map(s=>n.querySelector(s).getBoundingClientRect());return quantity.top>=code.bottom&&unit.top>=code.bottom&&Math.abs(quantity.left-code.left)<2&&unit.left>=quantity.right&&Math.abs(unit.top+unit.height/2-quantity.top-quantity.height/2)<2;});
        assert.equal(below,true,'quantity and unit sit together below the SKU');
      }
      await qty.fill('4');await qty.dispatchEvent('change');
      await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent.includes('80.000'));
      await page.screenshot({path:shot+`/${width}-quick.png`});
      const snapshot=await page.evaluate(()=>({qty:document.querySelector('.pos-qty input').value,amount:document.querySelector('.pos-line-top>strong').textContent}));
      if(desktop){
        await checkLineMenu(page,shot+`/${width}-line-menu.png`);
        const quantity=page.locator('.pos-qty').first(),placement=await quantity.evaluate(n=>{const [minus,input,plus]=[n.children[0],n.children[1],n.children[2]].map(x=>x.getBoundingClientRect());return minus.right<=input.left+1&&input.right<=plus.left+1&&Math.abs(minus.y-plus.y)<2;});assert.equal(placement,true,'minus and plus stay next to quantity');
        await quantity.locator('button').last().click();await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='100.000 đ');await quantity.locator('button').first().click();await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='80.000 đ');
        const discount=page.locator('.pos-line-discount').first();assert.equal(await discount.isVisible(),true,'CK is directly visible without opening the row menu');
        const within=await discount.evaluate(n=>{const a=n.getBoundingClientRect(),b=n.closest('.pos-line').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right;});assert.equal(within,true,'discount column fits its product row');
        await discount.locator('input').fill('10');await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='72.000 đ');
        await discount.locator('select').selectOption('amount');await discount.locator('input').fill('5000');await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='75.000 đ');
        await discount.locator('select').selectOption('percent');await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='80.000 đ');
        const before=calls.filter(c=>c.method!=='GET'&&!['/pos/preview','/pos/ghn/locations'].includes(c.path)).length;
        await page.getByRole('button',{name:'Bán thường',exact:true}).click();
        assert.equal(await discount.isVisible(),true,'CK stays visible in normal mode');
        assert.equal(await page.locator('.pos-ref-products').isVisible(),true);
        await page.getByRole('button',{name:'Bộ lọc sản phẩm',exact:true}).click();
        assert.equal(await page.locator('.pos-product-filters').isVisible(),true);
        await page.locator('.pos-product-filters').getByRole('button',{name:'Còn hàng',exact:true}).click();
        await page.locator('.pos-product-filters').getByRole('button',{name:'Tất cả',exact:true}).click();
        await page.getByRole('button',{name:'Bộ lọc sản phẩm',exact:true}).click();
        assert.equal(await qty.inputValue(),'4');
        assert.equal(await page.locator('.pos-checkout .pos-payment-footer').isVisible(),false);
        await page.screenshot({path:shot+`/${width}-normal.png`});
        await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();
        assert.equal(await discount.isVisible(),true,'CK stays visible in delivery mode');
        const inlineDiscount=await discount.evaluate(n=>{const d=n.getBoundingClientRect(),p=n.closest('.pos-line').querySelector('.pos-line-price').getBoundingClientRect(),r=n.closest('.pos-line').getBoundingClientRect();return Math.abs((d.top+d.bottom)/2-(p.top+p.bottom)/2)<2&&d.left>=p.right&&d.right<=r.right;});
        assert.equal(inlineDiscount,true,'delivery discount shares the price row without overlap');
        await page.locator('.pos-ref-carrier').waitFor();
        assert.equal(await page.getByText('Cổng GHN',{exact:true}).isVisible(),true);
        assert.equal(await qty.inputValue(),'4');
        const delivery=page.locator('.pos-ref-delivery-form');
        const carrier=delivery.getByLabel('Hình thức giao',{exact:true});
        for(const [id,name] of [['anh_chinh','Xe anh Chinh'],['chanh_xe','Chành xe'],['nhat_tin','Nhất Tín']]){
          await carrier.selectOption(id);assert.equal(await page.locator('.pos-ref-carrier-title').textContent(),'Cổng '+name);
          assert.equal(await page.getByLabel('Tên nhà xe / người giao',{exact:true}).isVisible(),true);
        }
        await carrier.selectOption('ghn');

        const deposit=page.getByLabel('Đã cọc (VNĐ)',{exact:true});
        const deposited=page.locator('.pos-ref-delivery-totals .pos-ref-deposited'),balance=page.locator('.pos-ref-delivery-totals .pos-ref-balance');
        assert.equal(await deposit.inputValue(),'0');assert.equal(await balance.textContent(),'80.000 đ');
        await deposit.fill('20000');assert.equal(await deposit.inputValue(),'20000');assert.equal(await balance.textContent(),'60.000 đ');
        await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
        await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();
        assert.equal(await balance.textContent(),'60.000 đ','switching mode keeps deposit summary');
        await deposit.fill('80000');assert.equal(await balance.textContent(),'0 đ');
        await deposit.fill('80001');assert.equal(await balance.textContent(),'—','invalid deposit must not show a negative balance');
        await deposit.fill('20000');
        await page.screenshot({path:shot+`/${width}-deposit.png`});
        await deposit.fill('0');
        await delivery.getByText('Số nhà, tên đường',{exact:true}).locator('..').locator('input').fill('123 Đường kiểm thử');
        const selects=delivery.locator('.pos-step-section').nth(1).locator('select');
        await selects.nth(0).selectOption('1');await selects.nth(1).selectOption('2');await selects.nth(2).selectOption('3');
        await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
        await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();
        assert.equal(await delivery.getByText('Số nhà, tên đường',{exact:true}).locator('..').locator('input').inputValue(),'123 Đường kiểm thử');
        const fit=await delivery.evaluate(n=>{const pane=n.closest('.pos-checkout').getBoundingClientRect();return [...n.querySelectorAll('input,select')].filter(x=>x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.left>=pane.left&&r.right<=pane.right;});});assert.equal(fit,true,'delivery fields fit inside recipient column');
        await page.screenshot({path:shot+`/${width}-delivery.png`});
        // Merely changing view/entering addresses cannot charge or create a carrier order.
        assert.equal(calls.filter(c=>c.method!=='GET'&&!['/pos/preview','/pos/ghn/locations'].includes(c.path)).length,before);
        assert.equal(await page.locator('.pos-ref-web-count').textContent(),'1','website shortcut shows the pending count from the order board');
        assert.equal(await page.locator('.pos-payment-method[data-method=cod]').isVisible(),false,'desktop delivery uses the bottom tab');
        await page.getByRole('button',{name:'Đơn website cần giao',exact:true}).click();
        await page.locator('.pos-order-board').waitFor();
        assert.equal(await page.locator('.pos-order-board').isVisible(),true);await page.getByText('WEB_REF_001',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Đơn hàng cửa hàng',exact:true}).click();
        await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>({qty:document.querySelector('.pos-qty input').value,amount:document.querySelector('.pos-line-top>strong').textContent})),snapshot);
        const bounds=await page.locator('.pos-payment-footer').boundingBox();assert.ok(bounds.y+bounds.height<=height-45,'payment footer remains on screen');
        const head=await page.locator('.pos-head').boundingBox();assert.ok(head.y>=0&&head.x>=0);
        if(width===1280){
          await page.locator('.pos-customer-trigger').click();
          await page.locator('.pos-customer-picker .pos-customer-option').filter({hasText:'Nguyễn Khách kiểm thử'}).click();
          await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent.includes('80.000'));
          await page.getByRole('button',{name:'Bán thường',exact:true}).click();
          await page.locator('.pos-ref-normal-footer').getByRole('button',{name:'THANH TOÁN',exact:true}).click();
          assert.equal(await page.locator('.pos-reference-checkout').count(),1,'normal mode opens existing payment controls');
          await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();
          const editor=page.locator('.pos-ref-delivery-form'),review=editor.locator('.pos-step-review');
          await page.keyboard.press('F9');
          await review.waitFor();assert.match(await review.textContent(),/80.000/);
          const submitted=calls.filter(c=>c.path==='/pos/checkout').length;
          await qty.fill('5');await qty.dispatchEvent('change');
          assert.equal(await review.isVisible(),false,'editing the cart invalidates a previously reviewed COD amount');
          await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent.includes('100.000'));
          assert.match(await page.locator('.pos-ref-carrier-body').textContent(),/100.000/);
          await carrier.selectOption('nhat_tin');
          await page.getByLabel('Mã vận đơn / phiếu gửi',{exact:true}).fill('NT-FIXTURE-001');
          await deposit.fill('20000');
          await page.keyboard.press('F9');
          await review.waitFor();assert.match(await review.textContent(),/100.000/);assert.match(await review.textContent(),/Nhất Tín/);

          assert.equal(calls.filter(c=>c.path==='/pos/checkout').length,submitted,'review cannot create an order');
          await page.locator('.pos-ref-carrier-footer button[type=submit]').click();
          await page.waitForFunction(()=>window.printCount>0);
          assert.equal(calls.filter(c=>c.path==='/pos/checkout').length,submitted+1,'one checkout after explicit final confirmation');
          const body=calls.filter(c=>c.path==='/pos/checkout').at(-1).body;
          assert.equal(body.fulfillmentMode,'cod');assert.equal(body.rows[0].qty,5);assert.equal(body.delivery.receiverPhone,'0901234567');
          const [order]=await f.db.select().from(salesOrders);assert.equal(order.total,100000);assert.equal(order.fulfillmentMode,'cod');
          const receipts=await f.db.select().from(customerPayments);assert.equal(receipts.length,1);assert.equal(receipts[0].amount,20000);assert.equal(body.delivery.deliveryMethod,'nhat_tin');assert.equal(body.delivery.ghnDistrictId,undefined);
        }
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no document horizontal overflow');
      assert.deepEqual(errors,[]);
      results.push({width,height,modes:desktop?3:1,cartPreserved:true,pageErrors:errors.length});
    } catch(error) {console.log('DEBUG',JSON.stringify({errors,notices:await page.evaluate(()=>window.notices),lastCalls:calls.slice(-5)}));await page.screenshot({path:shot+`/${width}-failure.png`});throw error;} finally {await context.close();}
  }
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
