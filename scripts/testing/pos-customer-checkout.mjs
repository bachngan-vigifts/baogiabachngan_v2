/** Real POS + local CRM router/PGlite. Preview is deliberately slower than the 180ms debounce. No checkout. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup();await f.open();const user=(await f.call('/me',f.emp)).data.user;
await f.db.insert(customers).values([
 {id:'retail-tax-rule',name:'Khách không MST',phone:'0907777701',contact:'',email:'',address:'',taxCode:'',isRetail:false,search:'',sourceVersion:0,syncedAt:''},
 {id:'business-tax-rule',name:'Công ty có MST',phone:'0907777702',contact:'',email:'',address:'',taxCode:'0312345678',isRetail:true,search:'',sourceVersion:0,syncedAt:''},
]);
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),calls=[];
const html=`<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"></script><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>console.log(message),confirmBox:async()=>true,go:hash=>location.hash=hash});await pos.load();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
 calls.push({path:path.slice(4),method:req.method,body});if(path==='/api/pos/preview')await new Promise(r=>setTimeout(r,350));
 const r=await f.call(path.slice(4)+u.search,f.emp,req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(path==='/'?html:await readFile(root+path));
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const shot=process.env.POS_SCREENSHOT_DIR||'/workspace/scratch/pos-customer-checkout';await mkdir(shot,{recursive:true});
try{for(const width of [375,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message);});await page.goto(origin);await page.waitForFunction(()=>window.ready);
 const add=async()=>{await page.locator('.pos-product-tile').first().click();if(width<=850)await page.locator('.pos-mobile-cart-open').click();await page.waitForFunction(()=>document.querySelector('.pos-line-unit-value')?.textContent==='108.000 đ');};
 const clear=async()=>{const b=page.locator('.pos-cancel-order');if(!await b.isVisible())await b.evaluate(n=>n.closest('[popover]')?.showPopover());await b.click();await page.waitForFunction(()=>!document.querySelector('.pos-line'));};
 const pay=async()=>{await page.getByRole('button',{name:'THANH TOÁN',exact:true}).click();await page.locator('.pos-customer-picker').waitFor();};
 await add();const row=page.locator('.pos-line').first();await row.locator('input[aria-label^="Chiết khấu"]').fill('10');await page.waitForFunction(()=>document.querySelector('.pos-line-unit-value').textContent==='97.200 đ');
 await row.locator('.pos-qty input').fill('2');await page.waitForTimeout(600);assert.equal(await row.locator('.pos-line-unit-value').textContent(),'97.200 đ');
 await row.getByRole('combobox',{name:/Loại chiết khấu/}).selectOption('amount');await row.locator('input[aria-label^="Chiết khấu"]').fill('1000');await page.waitForFunction(()=>document.querySelector('.pos-line-unit-value').textContent==='107.500 đ');
 assert.ok(await row.locator('input[aria-label^="Chiết khấu"]').evaluate(n=>n.getBoundingClientRect().width<=92));
 assert.equal(await row.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'compact CK and price must fit the basket');await page.screenshot({path:shot+'/discount-'+width+'.png'});
 await pay();const picker=page.locator('.pos-customer-picker');await picker.getByRole('button',{name:'Khách B2B',exact:true}).click();await picker.locator('.pos-customer-option').filter({hasText:'Công ty có MST'}).waitFor();assert.equal(await picker.locator('.pos-customer-option').filter({hasText:'Khách không MST'}).count(),0);
 await picker.getByRole('button',{name:'Khách lẻ',exact:true}).click();await picker.locator('.pos-customer-option').filter({hasText:'Khách không MST'}).waitFor();assert.equal(await picker.locator('.pos-customer-option').filter({hasText:'Công ty có MST'}).count(),0);
 const previews=calls.filter(c=>c.path==='/pos/preview').length;await picker.locator('.pos-customer-option').filter({hasText:'Khách không MST'}).click();await page.locator('.pos-payment-modal').waitFor();assert.equal(calls.filter(c=>c.path==='/pos/preview').length,previews+1,'one fresh preview after customer selection despite slow network');
 await page.locator('.pos-payment-modal .pos-modal-close').click();
 // Picking from the ordinary customer button must not open payment.
 await page.locator('.pos-customer-trigger').click();await picker.getByRole('button',{name:'Khách B2B',exact:true}).click();await picker.locator('.pos-customer-option').filter({hasText:'Công ty có MST'}).click();await page.waitForTimeout(650);assert.equal(await page.locator('.pos-payment-modal').count(),0);
 await clear();await add();await pay();await page.locator('.pos-customer-picker .pos-modal-close').click();await page.locator('.pos-customer-trigger').click();await picker.locator('.pos-customer-option').filter({hasText:'Khách không MST'}).click();await page.waitForTimeout(650);assert.equal(await page.locator('.pos-payment-modal').count(),0,'cancelled payment intent never survives into a later manual selection');
 await clear();await add();await pay();await picker.getByRole('button',{name:'+ Khách mới',exact:true}).click();const create=page.locator('.pos-customer-create');await create.locator('[name=name]').fill('Khách mới '+width);await create.locator('[name=phone]').fill('0908888'+String(width).padStart(3,'0'));await create.getByRole('button',{name:'Lưu & chọn khách',exact:true}).click();await page.locator('.pos-payment-modal').waitFor();assert.ok((await page.locator('.pos-payment-meta').textContent()).includes('Khách mới '+width));
 await page.locator('.pos-payment-modal .pos-modal-close').click();assert.deepEqual(errors,[]);assert.equal(calls.filter(c=>c.path==='/pos/checkout').length,0);
 console.log(JSON.stringify({width,slowPreviewResume:true,newCustomerResume:true,cancelSafe:true,taxSegments:true,lineDiscountPrice:true,checkoutCalls:0,errors}));await context.close();
 }}finally{await browser.close();server.close();await f.client.close();}
