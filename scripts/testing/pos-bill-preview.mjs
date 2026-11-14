/** Popup xem nhanh bill POS trong màn trả hàng. Dữ liệu giả trong trang, không gọi API, không dùng dữ liệu production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/pos-bill-preview';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/test'){res.writeHead(200,{'content-type':'text/html'}).end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"></head><body></body></html>');return;}
 const data=await readFile(root+u.pathname);res.writeHead(200,{'content-type':u.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(data);}catch(e){res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
const d={registerName:'Quầy Lock',account:{balance:893860},order:{id:'ord-1',orderNo:'POS_010_02112026',orderDate:'2026-11-02',status:'delivering',customerName:'Khách thử <b>nghiệm</b>',phone:'0900000000',receiverName:'Chị Lan',receiverPhone:'0911111111',deliveryAddress:'12 Đường Thử, Quận 1',subtotal:827648,tax:66212,total:893860,note:'',posSnapshot:JSON.stringify({method:'cod',fees:{shippingFee:38500,service:{amount:0}},ghn:{fee:31000,expectedDelivery:'2026-11-04T10:00:00Z'}})},
 lines:[{sku:'00551010V',name:'Heo Tài Lộc 15cm màu Xám Chỉ Vàng - Mặc định - L1',unit:'cái',qty:1,unitPrice:792000,amount:792000,deliveredQty:0}]};
try{for(const width of[1366,390]){
 const page=await browser.newPage({viewport:{width,height:width<500?844:900},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test');
 await page.evaluate(async d=>{const {openBillPreview}=await import('/pos-returns.js');window.__opened=[];openBillPreview(d,{open:u=>window.__opened.push(u)});},d);
 const dlg=page.locator('dialog.pos-bill-preview[open]');await dlg.waitFor();const text=await dlg.innerText();
 for(const want of['Bill POS_010_02112026','Đang giao','Quầy Lock','Khách thử <b>nghiệm</b>','Chị Lan · 0911111111','12 Đường Thử','Thu hộ COD','31.000 đ','04/11/2026','00551010V','792.000 đ','38.500 đ','893.860 đ'])assert.ok(text.includes(want),'thiếu: '+want);
 assert.equal(await dlg.locator('dd b').count(),0,'tên khách hiện dạng chữ, không chèn HTML');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'không tràn ngang');
 const box=await dlg.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'popup nằm trong màn hình');
 await page.screenshot({path:out+'/bill-preview-'+width+'.png'});
 await dlg.getByRole('button',{name:'Mở trang đơn hàng đầy đủ (tab mới)'}).click();assert.deepEqual(await page.evaluate(()=>window.__opened),['/test#/orders/ord-1']);
 await dlg.getByRole('button',{name:'Đóng'}).click();await page.locator('dialog.pos-bill-preview').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);await page.close();}
 console.log('ok');}finally{await browser.close();server.close();}
process.exit(0);
