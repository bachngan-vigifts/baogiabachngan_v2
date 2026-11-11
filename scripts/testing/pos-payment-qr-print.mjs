/** Local-only POS QR print regression. All APIs and QR images are fixtures. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/pos-payment-qr-print';await mkdir(out,{recursive:true});
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><section id="pos"></section><script type="module">
import {initPos} from '/pos.js';window.calls=[];window.notices=[];window.printCount=0;
const sample={lines:[{name:'Bộ trà thử nghiệm',sku:'SP1',qty:1,listUnitPrice:773280,listAmount:773280,total:773280}],subtotal:716000,tax:57280,total:773280};
const api=async(path,method='GET',body)=>{calls.push({path,method,body});
 if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Quầy thử nghiệm',pricePolicyId:'retail'}],current:{id:'s',registerId:'r',memberId:'emp'},policies:[],shifts:[],templates:[]};
 if(path.startsWith('/pos/catalog'))return {products:[{sku:'SP1',name:'Bộ trà thử nghiệm',price:773280,available:10}],nextOffset:null};
 if(path.startsWith('/pos/customers'))return {canListRetail:true,customers:[{id:'test-customer',name:'Khách thử nghiệm',phone:'0900000000'}]};
 if(path.startsWith('/pos/orders'))return {orders:[],counts:{all:0}};
 if(path==='/pos/preview')return sample;
 if(path==='/pos/qr')return {id:'qr1',amount:773280,content:'Thanh toán đơn POS_TEST',url:'https://qr.example.test/payment.svg',expiresAt:new Date(Date.now()+600000).toISOString()};
 if(path==='/pos/qr/qr1/status')return {paid:false,consumed:false};
 throw Error('Unexpected API '+path);
};
window.ui=initPos({root:document.querySelector('#pos'),api,user:()=>({id:'emp',role:'manager'}),toast:m=>notices.push(m),confirmBox:async()=>false,go(){}});await ui.load();window.ready=true;
new MutationObserver(records=>{for(const record of records)for(const frame of record.addedNodes){if(frame.tagName==='IFRAME'){frame.contentWindow.print=()=>{window.printCount++;frame.dataset.printed='true';};}}}).observe(document.body,{childList:true});
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;if(path.includes('..'))throw Error('path');res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(path==='/'?html:await readFile(root+path.slice(1)));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [320,390,430,1280]){
 const context=await browser.newContext({viewport:{width,height:932}});
 await context.route('**/*',async r=>{if(r.request().url()==='https://qr.example.test/payment.svg'){await new Promise(resolve=>setTimeout(resolve,150));return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280"><rect width="280" height="280" fill="white"/><path d="M20 20h70v70H20zM190 20h70v70h-70zM20 190h70v70H20zM115 110h40v40h-40zM180 155h60v25h-60zM120 205h45v50h-45z" fill="black"/></svg>'});}return r.request().url().startsWith(base+'/')?r.continue():r.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>window.ready);
 await page.locator('.pos-product').click();await page.locator('.pos-customer-trigger').click();await page.getByRole('combobox',{name:'Tìm khách hàng',exact:true}).fill('Khách');await page.locator('.pos-customer-option').first().click();
 await page.getByRole('button',{name:'THANH TOÁN',exact:true}).click();const payment=page.locator('.pos-payment-modal');await payment.getByRole('button',{name:/Chuyển khoản/}).click();await payment.getByRole('button',{name:'Tạo mã QR',exact:true}).click();
 const qr=page.locator('.pos-qr-modal');await qr.locator('img').evaluate(img=>img.decode());await qr.getByRole('button',{name:'In mã thanh toán',exact:true}).scrollIntoViewIfNeeded();
 const geometry=await qr.locator('.pos-qr-footer').evaluate(footer=>{const d=footer.closest('dialog');return {noOverflow:d.scrollWidth<=d.clientWidth+1,buttons:[...footer.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})};});assert(geometry.noOverflow&&geometry.buttons,JSON.stringify(geometry));
 await page.screenshot({path:out+'/'+width+'-popup.png'});const writes=await page.evaluate(()=>calls.filter(c=>c.method!=='GET').length);await qr.getByRole('button',{name:'In mã thanh toán',exact:true}).click();await page.waitForFunction(()=>window.printCount===1);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.method!=='GET').length),writes,'printing makes no write API request');assert.equal(await page.evaluate(()=>calls.some(c=>c.path==='/pos/checkout')),false);assert.equal(await payment.locator('input[type=checkbox]').isChecked(),false);
 const frame=page.locator('iframe.pos-print-frame');const paper=await frame.evaluate(f=>{const d=f.contentDocument;return {html:d.documentElement.outerHTML,text:d.body.textContent,url:d.querySelector('img').src,loaded:d.querySelector('img').naturalWidth>0};});assert(paper.loaded);assert.equal(paper.url,'https://qr.example.test/payment.svg');assert.match(paper.text,/773.280 đ/);assert.match(paper.text,/Thanh toán đơn POS_TEST/);assert.doesNotMatch(paper.text,/ĐÃ THU TIỀN/);
 if(width===390){const preview=await context.newPage();await preview.setContent(paper.html);await preview.locator('img').evaluate(img=>img.decode());await preview.pdf({path:out+'/payment-qr-k80.pdf',width:'80mm',height:'160mm',printBackground:true});await preview.screenshot({path:out+'/print-preview.png'});await preview.close();}
 await frame.evaluate(f=>f.contentWindow.dispatchEvent(new Event('afterprint')));assert.equal(await frame.count(),0);assert.deepEqual(errors,[]);results.push({width,geometry,printInvoked:true,qrImageLoaded:true,noPaymentWrite:true,errors});await context.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();}
