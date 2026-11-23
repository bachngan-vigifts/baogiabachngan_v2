/** Chi tiết khách hàng trên điện thoại / máy tính bảng / PC (dữ liệu mẫu PGlite cục bộ, không gọi production).
 *  - Đủ tab như PC (Báo giá, HĐKT, Phiếu thu, Giao hàng, Hỏi tồn, Tài khoản…), chạm mở từng tab, số dòng khớp dữ liệu
 *    máy chủ trả cho ĐÚNG khách đó theo quyền người xem (Manager / nhân viên phụ trách); không lẫn phiếu của khách khác.
 *  - Nhóm nút đầu trang không tràn / cắt mép; menu ⋮ mở được; trang không cuộn ngang.
 *  Cỡ: 360, 390, 430, 768, 1440. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {customerPurchaseSuppliersFixture} from '../../tests/helpers/customer-purchase-suppliers-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await customerPurchaseSuppliersFixture();
const out=process.env.SCREENSHOT_DIR||'/tmp/mobile-customer-tabs';await mkdir(out,{recursive:true});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
// Phiếu thu cho khách đang xem và cho khách khác (để bắt lẫn dữ liệu).
for(const [orderId,customerId,ref] of [['h-one',f.id,'CK-KHACH-NAY'],['h-hidden','history-other-customer','CK-KHACH-KHAC']])
 await f.db.insert(customerPayments).values({id:'pay-'+orderId,orderId,customerId,amount:1000,paidAt:'2026-11-12',method:'transfer',reference:ref,createdBy:'mgr',createdAt:'2026-11-12T00:00:00.000Z'});
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const LIST={quotes:'quotes',catalogue:'catalogueQuotes',contracts:'contracts',payments:'payments',deliveries:'deliveries',stock:'stockRequests',accounts:'accounts',care:'care'};
const results=[];
try{
 for(const [role,cookie] of [['manager',f.mgr],['owner',f.emp]]){
  const overview=(await f.call('/customers/'+f.id+'/overview',cookie)).data;
  for(const width of (process.env.WIDTHS||'360,390,430,768,1440').split(',').map(Number)){
   const mobile=width<500,user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1];
   const context=await browser.newContext({viewport:{width,height:mobile?844:900},locale:'vi-VN',...(mobile?{isMobile:true,hasTouch:true}:{})});
   await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
   await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const name=`${role} ${width}px`;
   try{
    await page.goto(origin+'/#/customers/'+f.id);await page.locator('#customer-detail .cd-tabs [data-tab]').first().waitFor();
    // Nhóm nút đầu trang nằm trọn trong màn hình, không cắt chữ.
    const head=await page.evaluate(()=>{const W=innerWidth;return [...document.querySelectorAll('#customer-detail .editor-actions > *')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim()||b.getAttribute('aria-label'),out:r.right>W+1||r.left<-1,clip:b.scrollWidth>b.clientWidth+2};}).filter(b=>b.out||b.clip);});
    assert.deepEqual(head,[],name+': nút đầu trang tràn/cắt');
    if(mobile){const trigger=page.locator('#customer-detail .editor-actions .mobile-action-trigger');
     if(await trigger.isVisible()){await trigger.tap();const menu=page.locator('.mobile-action-sheet, .mobile-action-list, dialog[open]').last();await menu.waitFor({timeout:3000});
      assert.ok((await menu.locator('button,a').count())>0,name+': menu ⋮ có thao tác');await page.keyboard.press('Escape');await page.waitForTimeout(200);
      if(await menu.isVisible())await menu.locator('[data-close],.close,button:has-text("Đóng")').first().click().catch(()=>{});}}
    const tabs=await page.locator('#customer-detail .cd-tabs [data-tab]').evaluateAll(ts=>ts.map(t=>t.dataset.tab));
    for(const key of Object.keys(LIST))if(overview[LIST[key]]!==undefined)assert.ok(tabs.includes(key),name+': thiếu tab '+key);
    for(const key of tabs.filter(k=>k!=='overview')){
     const tab=page.locator(`#customer-detail .cd-tabs [data-tab="${key}"]`);
     assert.ok(await tab.isVisible()||await tab.evaluate(t=>t.getClientRects().length>0),name+': tab '+key+' bị ẩn');
     await tab.scrollIntoViewIfNeeded();if(mobile)await tab.tap();else await tab.click();
     await page.locator(`#customer-detail .cd-tabs [data-tab="${key}"][aria-selected="true"]`).waitFor({timeout:4000});
     const body=page.locator('#customer-detail .cd-tab-body');await body.waitFor();
     const text=await body.innerText();
     assert.doesNotMatch(text,/CK-KHACH-KHAC|h-hidden/,name+': tab '+key+' lẫn dữ liệu khách khác');
     const list=overview[LIST[key]];
     if(Array.isArray(list)&&key!=='care'){
      const rows=await body.locator('tbody tr').evaluateAll(rs=>rs.filter(r=>!r.querySelector('.empty,[colspan]')).length);
      assert.equal(rows,list.length,name+': tab '+key+' số dòng ('+rows+') khác dữ liệu máy chủ ('+list.length+')');
     }
     if(key==='payments')assert.match(text,/CK-KHACH-NAY/,name+': phiếu thu của khách này');
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=0,name+': cuộn ngang '+overflow+'px');
    assert.deepEqual(errors,[],name+': lỗi JS');
    await page.locator('#customer-detail .cd-tabs [data-tab="overview"]').click();await page.waitForTimeout(400);
    const overlay=await page.evaluate(()=>[...document.querySelectorAll('dialog[open],[popover]:popover-open,.modal-backdrop,.loading-overlay')].filter(n=>n.getClientRects().length).map(n=>n.tagName+'#'+n.id+'.'+n.className));
    assert.deepEqual(overlay,[],name+': còn lớp phủ/hộp thoại mở sau khi chạm tab');await page.screenshot({path:`${out}/${role}-${width}.png`});
    results.push(['✔',name+': '+tabs.length+' tab']);
   }catch(e){results.push(['✘',(e.message||String(e)).split('\n')[0]]);await page.screenshot({path:`${out}/FAIL-${role}-${width}.png`}).catch(()=>{});}
   await context.close();
  }
 }
}finally{await browser.close();server.close();}
for(const [s,n] of results)console.log(s,n);
const fail=results.filter(r=>r[0]==='✘').length;console.log(JSON.stringify({pass:results.length-fail,fail}));if(fail)process.exitCode=1;
